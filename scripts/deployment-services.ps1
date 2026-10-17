# Service lifecycle only. No database, settings, credentials or service configuration changes.
function Get-DeploymentServicePlan {
  $names = @('AbdoErpLocal', 'AbdoErpLocalProxy', 'AbdoErpTunnel')
  $services = @{}
  foreach ($name in $names) {
    $service = Get-Service -Name $name -ErrorAction SilentlyContinue
    if (-not $service) {
      if ($name -eq 'AbdoErpTunnel') { continue }
      throw "Required service is missing: $name"
    }
    if ([string]$service.Status -notin @('Running', 'Stopped')) {
      throw "Service $name is transitioning ($($service.Status)); wait before deploying."
    }
    if ([string]$service.StartType -eq 'Disabled') { throw "Service $name is disabled; deployment was not started." }
    $services[$name] = $service
  }
  $order = [Collections.Generic.List[string]]::new()
  $visiting = @{}
  function Visit-DeploymentService([string]$Name) {
    if ($order.Contains($Name)) { return }
    if ($visiting[$Name]) { throw 'Circular service dependency detected.' }
    $visiting[$Name] = $true
    foreach ($dependent in $services[$Name].DependentServices) {
      if ($services.ContainsKey($dependent.Name)) {
        Visit-DeploymentService $dependent.Name
      } elseif ([string]$dependent.Status -ne 'Stopped') {
        throw "Unexpected active dependent $($dependent.Name) of $Name; no services were changed."
      }
    }
    $visiting[$Name] = $false
    $order.Add($Name)
  }
  # Prefer tunnel, proxy, API when Windows declares no dependency between them.
  foreach ($name in @('AbdoErpTunnel', 'AbdoErpLocalProxy', 'AbdoErpLocal')) {
    if ($services.ContainsKey($name)) { Visit-DeploymentService $name }
  }
  $startOrder = @($order.ToArray())
  [array]::Reverse($startOrder)
  [pscustomobject]@{
    StopOrder = @($order.ToArray())
    StartOrder = $startOrder
    InitialRunning = @($names | Where-Object { $services.ContainsKey($_) -and [string]$services[$_].Status -eq 'Running' })
  }
}

function Stop-DeploymentServices($Plan) {
  foreach ($name in $Plan.StopOrder) {
    $service = Get-Service -Name $name -ErrorAction Stop
    if ([string]$service.Status -eq 'Stopped') { continue }
    if ([string]$service.Status -ne 'StopPending') {
      # No Force and no process termination: an unplanned dependency must block deployment.
      Stop-Service -Name $name -NoWait -ErrorAction Stop
    }
    $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60))
    $service.Refresh()
    if ([string]$service.Status -ne 'Stopped') { throw "Service $name did not stop safely." }
  }
}

function Start-DeploymentServices($Plan, [switch]$RestoreOriginal) {
  $failures = [Collections.Generic.List[string]]::new()
  foreach ($name in $Plan.StartOrder) {
    if ($RestoreOriginal -and $Plan.InitialRunning -notcontains $name) { continue }
    try {
      $service = Get-Service -Name $name -ErrorAction Stop
      if ([string]$service.Status -eq 'StopPending') {
        $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60))
        $service.Refresh()
      }
      if ([string]$service.Status -ne 'Running') {
        if ([string]$service.Status -ne 'StartPending') { Start-Service -Name $name -ErrorAction Stop }
        $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
      }
      $service.Refresh()
      if ([string]$service.Status -ne 'Running') { throw "Service $name did not start." }
    } catch {
      $failures.Add("${name}: $($_.Exception.Message)")
      if (-not $RestoreOriginal) { throw }
    }
  }
  if ($failures.Count) { throw ($failures -join '; ') }
}
