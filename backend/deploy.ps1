# Deploys the GlycoTank accounts + sync backend (CloudFormation / SAM) to AWS
# and writes the stack outputs into src/cloud-config.js for the app.
#
#   powershell -ExecutionPolicy Bypass -File backend/deploy.ps1
#
# Requires an active AWS CLI session (aws login --region us-east-1).

# Native-command stderr must not abort the script (Windows PowerShell 5.1);
# each aws call is checked with $LASTEXITCODE instead.
$ErrorActionPreference = "Continue"
$Region = "us-east-1"
$Stack = "glycotank-prod"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$account = (aws sts get-caller-identity --region $Region --query Account --output text)
if ($LASTEXITCODE -ne 0) { throw "AWS session not active. Run: aws login --region $Region" }

# Bucket that holds the packaged Lambda code.
$bucket = "glycotank-deploy-$account"
aws s3api head-bucket --bucket $bucket --region $Region 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  aws s3api create-bucket --bucket $bucket --region $Region | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "could not create bucket $bucket" }
  aws s3api put-public-access-block --bucket $bucket --region $Region --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
}

$packaged = Join-Path $env:TEMP "glycotank-packaged.yaml"
aws cloudformation package --template-file "$here\template.yaml" --s3-bucket $bucket --output-template-file $packaged --region $Region | Out-Null
if ($LASTEXITCODE -ne 0) { throw "package failed" }
aws cloudformation deploy --template-file $packaged --stack-name $Stack --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --region $Region --no-fail-on-empty-changeset
if ($LASTEXITCODE -ne 0) { throw "deploy failed" }

$out = @{}
(aws cloudformation describe-stacks --stack-name $Stack --region $Region --query "Stacks[0].Outputs" --output json | ConvertFrom-Json) | ForEach-Object { $out[$_.OutputKey] = $_.OutputValue }

$config = @"
// Filled in from the backend stack outputs (backend/deploy.ps1 writes this file).
export const CLOUD = {
  region: "$($out.Region)",
  apiUrl: "$($out.ApiUrl)",
  userPoolId: "$($out.UserPoolId)",
  clientId: "$($out.AppClientId)",
  authDomain: "$($out.AuthDomain)",
  // Social sign-in buttons appear once each provider is set up in Cognito.
  providers: [],
};
"@
# UTF-8 without a byte-order mark (Set-Content -Encoding utf8 adds one in PowerShell 5.1).
[System.IO.File]::WriteAllText((Join-Path $here "..\src\cloud-config.js"), $config + "`n", (New-Object System.Text.UTF8Encoding $false))
Write-Host "Deployed. API: $($out.ApiUrl)"
