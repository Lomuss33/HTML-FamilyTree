param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("prepare", "encrypt", "generate:anchors", "enable:all-anchors", "backup", "restore", "check:publish", "release:prepare", "apply:additions")]
    [string] $Task,
    [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
    [string[]] $TaskArguments
)

$ErrorActionPreference = "Stop"
$previousFamilyPassword = $env:FAMILY_TREE_PASSWORD
$previousNewPassword = $env:FAMILY_TREE_NEW_PASSWORD
$taskExitCode = 1
function Read-LocalSecret([string] $Prompt) {
    $secretValue = Read-Host $Prompt -AsSecureString
    $secretPointer = [IntPtr]::Zero
    try {
        $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretValue)
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
    } finally {
        if ($secretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer) }
        $secretValue.Dispose()
    }
}
try {
    $env:FAMILY_TREE_PASSWORD = Read-LocalSecret "Family password (entered only on this computer)"
    if ($TaskArguments -contains "--rotate-password") {
        $env:FAMILY_TREE_NEW_PASSWORD = Read-LocalSecret "New family password"
    }
    Push-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
    try {
        & npm.cmd run $Task -- @TaskArguments
        $taskExitCode = $LASTEXITCODE
    } finally { Pop-Location }
} finally {
    $env:FAMILY_TREE_PASSWORD = $previousFamilyPassword
    $env:FAMILY_TREE_NEW_PASSWORD = $previousNewPassword
    $previousFamilyPassword = $null
    $previousNewPassword = $null
}
exit $taskExitCode
