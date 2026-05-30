Add-Type -AssemblyName System.Drawing
$processName = "chrome"
$process = Get-Process -Name $processName -ErrorAction SilentlyContinue | Select-Object -First 1
if ($process -and $process.Path) {
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($process.Path)
    $ms = New-Object System.IO.MemoryStream
    $icon.ToBitmap().Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $b64 = [Convert]::ToBase64String($ms.ToArray())
    Write-Output $b64
} else {
    Write-Output "NO_ICON"
}
