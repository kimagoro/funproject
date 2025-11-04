# PowerShell script to send a specific test XML event for tracking

$xml = @"
<Event>
  <ETYPE>0</ETYPE>
  <TRDESC>Antipassback Violation</TRDESC>
  <STAFFNAME>SIVAVENAYAKAM A/L VELAYUTHAM</STAFFNAME>
  <STAFFNO>10-03</STAFFNO>
  <DEVNAME>Barrier GateIN</DEVNAME>
  <CARDNO>0281007770</CARDNO>
  <TRDATE>20250923</TRDATE>
  <TRTIME>145306</TRTIME>
</Event>
"@

Write-Host "Sending XML event for tracking test to TCP server on localhost:3001..." -ForegroundColor Cyan

try {
    $client = New-Object System.Net.Sockets.TcpClient("localhost", 3001)
    $stream = $client.GetStream()
    $writer = New-Object System.IO.StreamWriter($stream)
    $reader = New-Object System.IO.StreamReader($stream)
    
    $writer.WriteLine($xml)
    $writer.Flush()
    
    # Wait for response
    Start-Sleep -Milliseconds 500
    if ($stream.DataAvailable) {
        $response = $reader.ReadLine()
        Write-Host "Response: $response" -ForegroundColor Green
    }
    
    $writer.Close()
    $reader.Close()
    $stream.Close()
    $client.Close()
    
    Write-Host "Tracking test event sent successfully!" -ForegroundColor Green
}
catch {
    Write-Host "Error: $_" -ForegroundColor Red
}
