# Pre-compiles the landing page and dashboard route in the background right
# after `run.bat` starts the frontend dev server.
#
# Next.js dev mode compiles each route on its first HTTP request no matter
# who makes that request (measured: ~1-6s depending on cache state, for
# either route). Without this script, that one-time cost lands exactly when
# the user opens the browser and clicks "Open Dashboard" - this script moves
# it earlier, into the few seconds the user is opening the browser tab
# anyway, so it's already paid for by the time they click through.
#
# A plain HTTP GET only triggers Next's server-side compile/render for these
# routes - it does not run the dashboard's client-side data fetch, which
# only ever executes in a real browser (React effects don't run during a
# bare GET), so this cannot double-scan or double-analyze on the backend.
$ProgressPreference = 'SilentlyContinue'

for ($i = 0; $i -lt 60; $i++) {
    try {
        Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/' -TimeoutSec 2 | Out-Null
        break
    } catch {
        Start-Sleep -Milliseconds 500
    }
}

try {
    Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/mission-control' -TimeoutSec 15 | Out-Null
} catch {}
