Add-Type -AssemblyName System.Drawing
$name = "Everything"
$path = ""

# 1. Try Get-Process
$p = Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1
if ($p) { $path = $p.Path }

# 2. Try CIM
if (-not $path) {
    $cp = Get-CimInstance Win32_Process -Filter "Name LIKE '$name.exe' OR Name = '$name'" | Where-Object { $_.ExecutablePath } | Select-Object -First 1
    if ($cp) { $path = $cp.ExecutablePath }
}

if ($path) {
    Write-Host "FOUND PATH: $path"
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($path)
    $ms = New-Object System.IO.MemoryStream
    $icon.ToBitmap().Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "BASE64_START"
    Write-Output ([Convert]::ToBase64String($ms.ToArray()))
} else {
    Write-Host "NO_PATH_FOUND"
}
