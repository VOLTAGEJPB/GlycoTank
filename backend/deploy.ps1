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
# Send account emails through SES once the domain is verified (DNS records in
# Cloudflare); until then Cognito's built-in sender is used.
$EmailDomain = "glycotank.voltagejpb.com"
# SES must also be out of the sandbox: in it, mail only reaches pre-verified
# addresses, so new users would never get their sign-up code.
$verified = aws sesv2 get-email-identity --email-identity $EmailDomain --region $Region --query VerifiedForSendingStatus --output text 2>$null
$production = aws sesv2 get-account --region $Region --query ProductionAccessEnabled --output text 2>$null
if ($verified -eq "True" -and $production -eq "True") { Write-Host "Sending account emails from $EmailDomain via SES" }
else { Write-Host "SES not ready (domain verified: $verified, production access: $production); using Cognito's built-in email"; $EmailDomain = "" }

# Google / Apple sign-in keys live outside the repo, in
# %LOCALAPPDATA%\GlycoTank-signing\social-signin.json (see backend/social-signin.example.json).
# Missing or blank values leave that provider off.
$params = @{ EmailDomain = $EmailDomain }
$socialFile = Join-Path $env:LOCALAPPDATA "GlycoTank-signing\social-signin.json"
if (Test-Path $socialFile) {
  $social = Get-Content $socialFile -Raw | ConvertFrom-Json
  foreach ($k in "GoogleClientId", "GoogleClientSecret", "AppleServicesId", "AppleTeamId", "AppleKeyId") { if ($social.$k) { $params[$k] = "$($social.$k)".Trim() } }
  if ($social.ApplePrivateKeyFile -and (Test-Path $social.ApplePrivateKeyFile)) { $params.ApplePrivateKey = (Get-Content $social.ApplePrivateKeyFile -Raw).Trim() }
}
Write-Host ("Google sign-in: " + [bool]$params.GoogleClientId + ", Apple sign-in: " + [bool]$params.AppleServicesId)
# Passed as a JSON file so the multi-line Apple key survives intact.
$paramFile = Join-Path $env:TEMP "glycotank-params.json"
$list = @($params.GetEnumerator() | ForEach-Object { @{ ParameterKey = $_.Key; ParameterValue = "$($_.Value)" } })
[System.IO.File]::WriteAllText($paramFile, (ConvertTo-Json -InputObject $list -Depth 3), (New-Object System.Text.UTF8Encoding $false))

aws cloudformation deploy --template-file $packaged --stack-name $Stack --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --region $Region --no-fail-on-empty-changeset --parameter-overrides "file://$paramFile"
$deployExit = $LASTEXITCODE
Remove-Item $paramFile -ErrorAction SilentlyContinue
if ($deployExit -ne 0) { throw "deploy failed" }

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
  // Social sign-in buttons shown in the app (set up in backend/deploy.ps1).
  providers: [$((($out.Providers -split ",") | Where-Object { $_ } | ForEach-Object { '"' + $_ + '"' }) -join ", ")],
};
"@
# UTF-8 without a byte-order mark (Set-Content -Encoding utf8 adds one in PowerShell 5.1).
[System.IO.File]::WriteAllText((Join-Path $here "..\src\cloud-config.js"), $config + "`n", (New-Object System.Text.UTF8Encoding $false))
Write-Host "Deployed. API: $($out.ApiUrl)"
