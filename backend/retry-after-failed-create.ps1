# Cleans up after a failed first deploy (stack in ROLLBACK_COMPLETE), then redeploys.
# The user pool and table are kept on rollback (DeletionPolicy: Retain), which blocks
# a new create. They are removed only if they are completely empty.
#
#   powershell -ExecutionPolicy Bypass -File backend/retry-after-failed-create.ps1

$ErrorActionPreference = "Continue"
$Region = "us-east-1"
$Stack = "glycotank-prod"
$Table = "glycotank-prod-data"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$status = aws cloudformation describe-stacks --stack-name $Stack --region $Region --query "Stacks[0].StackStatus" --output text 2>$null
if ($status -ne "ROLLBACK_COMPLETE") { throw "Stack is '$status', not ROLLBACK_COMPLETE; nothing to clean up." }

$items = aws dynamodb scan --table-name $Table --select COUNT --region $Region --query Count --output text 2>$null
if ($LASTEXITCODE -eq 0) {
  if ([int]$items -ne 0) { throw "$Table has $items items; not deleting it." }
  aws dynamodb delete-table --table-name $Table --region $Region | Out-Null
  aws dynamodb wait table-not-exists --table-name $Table --region $Region
  Write-Host "Removed empty table $Table"
}

$pools = aws cognito-idp list-user-pools --max-results 60 --region $Region --query "UserPools[?Name=='$Stack'].Id" --output text
foreach ($pool in ($pools -split "\s+" | Where-Object { $_ })) {
  $users = aws cognito-idp list-users --user-pool-id $pool --region $Region --query "length(Users)" --output text
  if ([int]$users -ne 0) { throw "User pool $pool has $users users; not deleting it." }
  aws cognito-idp delete-user-pool --user-pool-id $pool --region $Region
  Write-Host "Removed empty user pool $pool"
}

aws cloudformation delete-stack --stack-name $Stack --region $Region
aws cloudformation wait stack-delete-complete --stack-name $Stack --region $Region
Write-Host "Removed failed stack. Deploying again..."

& (Join-Path $here "deploy.ps1")
