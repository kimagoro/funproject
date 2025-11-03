import express from 'express';
import path from 'path';
import { createServer } from 'http';
import { DatabaseManager } from '../shared/database';
import { configManager } from '../shared/config';
import { wsBroadcaster } from '../shared/websocket';
import * as fs from 'fs';

const app = express();
const server = createServer(app);
const PORT = 3000;
const db = new DatabaseManager();

// Initialize WebSocket server
wsBroadcaster.initialize(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/snapshots', express.static(path.join(__dirname, '../../snapshots')));

// Health check endpoint for Docker
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/events', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const events = db.getRecentEvents(limit);
    res.json({ success: true, data: events, count: events.length });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch events' });
  }
});

app.get('/api/events/all', (req, res) => {
  try {
    const fromDate = req.query.fromDate as string;
    const toDate = req.query.toDate as string;
    const days = req.query.days ? parseInt(req.query.days as string) : undefined;
    
    let events: any[];
    
    if (fromDate || toDate) {
      // Date range filtering
      const fromTimestamp = fromDate ? new Date(fromDate).getTime() : undefined;
      const toTimestamp = toDate ? new Date(toDate).getTime() : undefined;
      events = db.getEventsByDateRange(fromTimestamp, toTimestamp);
      console.log(`Fetched ${events.length} events from date range`);
    } else if (days) {
      // Last N days
      events = db.getEventsFromLastDays(days);
      console.log(`Fetched ${events.length} events from last ${days} days`);
    } else {
      // Default: last 7 days for performance
      events = db.getEventsFromLastDays(7);
      console.log(`Fetched ${events.length} events from last 7 days (default)`);
    }
    
    res.json({ success: true, data: events, count: events.length });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch events' });
  }
});

app.get('/api/config', (req, res) => {
  try {
    const config = configManager.getConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to load config' });
  }
});

app.post('/api/config', (req, res) => {
  try {
    const configPath = path.join(__dirname, '../../config.json');
    const currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    // Update only the fields that are provided
    if (req.body.forwarding) {
      currentConfig.forwarding = { ...currentConfig.forwarding, ...req.body.forwarding };
    }
    if (req.body.filtering) {
      currentConfig.filtering = { ...currentConfig.filtering, ...req.body.filtering };
    }
    
    // Write back to file
    fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 2), 'utf-8');
    
    // Reload config in memory
    configManager.reloadConfig();
    
    res.json({ success: true, message: 'Configuration updated. Please restart the server for changes to take full effect.' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Staff API endpoints
app.get('/api/staff', (req, res) => {
  try {
    const staff = db.getAllStaff();
    res.json({ success: true, data: staff, count: staff.length });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch staff' });
  }
});

app.get('/api/staff/:cardno', (req, res) => {
  try {
    const staff = db.getStaffByCardNo(req.params.cardno);
    if (staff) {
      res.json({ success: true, data: staff });
    } else {
      res.status(404).json({ success: false, error: 'Staff not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch staff' });
  }
});

// Door-Camera configuration API endpoints
app.get('/api/door-cameras', (req, res) => {
  try {
    const doors = db.getAllDoorCameras();
    res.json({ success: true, data: doors, count: doors.length });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch door cameras' });
  }
});

app.get('/api/door-cameras/:devname', (req, res) => {
  try {
    const door = db.getDoorCamera(decodeURIComponent(req.params.devname));
    if (door) {
      res.json({ success: true, data: door });
    } else {
      res.status(404).json({ success: false, error: 'Door camera not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch door camera' });
  }
});

app.post('/api/door-cameras', (req, res) => {
  try {
    db.upsertDoorCamera(req.body);
    res.json({ success: true, message: 'Door camera configuration saved' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/door-cameras/:devname', (req, res) => {
  try {
    const deleted = db.deleteDoorCamera(decodeURIComponent(req.params.devname));
    if (deleted) {
      res.json({ success: true, message: 'Door camera deleted' });
    } else {
      res.status(404).json({ success: false, error: 'Door camera not found' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test snapshot capture endpoint
app.post('/api/test-snapshot/:devname', async (req, res) => {
  try {
    const { cctvService } = await import('../shared/cctv');
    const devname = decodeURIComponent(req.params.devname);
    const result = await cctvService.captureSnapshot(devname, 0);
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: 'Snapshot captured successfully',
        imagePath: result.imagePath,
        streamUrl: result.streamUrl
      });
    } else {
      res.json({ 
        success: false, 
        error: result.error,
        streamUrl: result.streamUrl
      });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/config/doors', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Door/Camera Configuration - EvokePass</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 0; }
    .container { max-width: 100%; margin: 0 auto; }
    
    /* Header with logo and menu */
    header { background: white; padding: 10px 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; }
    .logo-section { display: flex; align-items: center; gap: 15px; }
    .logo { max-width: 80px; height: auto; }
    .brand-text { font-size: 1.3rem; font-weight: bold; color: #667eea; margin: 0; }
    
    /* Navigation Menu */
    .nav-menu { display: flex; gap: 5px; align-items: center; }
    .nav-menu a, .nav-menu button { padding: 8px 16px; background: #667eea; color: white; text-decoration: none; border: none; border-radius: 5px; font-weight: 600; font-size: 0.9rem; cursor: pointer; transition: background 0.3s; }
    .nav-menu a:hover, .nav-menu button:hover { background: #5568d3; }
    .nav-menu a.active { background: #5568d3; }
    
    /* Content area */
    .content { padding: 20px; }
    .controls { background: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); display: flex; justify-content: space-between; align-items: center; }
    .add-btn { padding: 10px 20px; background: #28a745; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 1rem; font-weight: bold; }
    .add-btn:hover { background: #218838; }
    .table-container { background: white; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    thead { background: #667eea; color: white; position: sticky; top: 0; z-index: 10; }
    th { padding: 15px 12px; text-align: left; font-weight: 600; font-size: 0.9rem; white-space: nowrap; }
    tbody tr { border-bottom: 1px solid #e9ecef; transition: background 0.2s; }
    tbody tr:hover { background: #f8f9fa; }
    td { padding: 12px; font-size: 0.9rem; }
    .actions button { padding: 6px 12px; margin-right: 5px; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem; }
    .edit-btn { background: #007bff; color: white; }
    .test-btn { background: #28a745; color: white; }
    .test-btn:hover { background: #218838; }
    .delete-btn { background: #dc3545; color: white; }
    .modal { display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); }
    .modal-content { background: white; margin: 5% auto; padding: 30px; border-radius: 10px; max-width: 600px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .modal-header h2 { color: #333; }
    .close { font-size: 28px; font-weight: bold; cursor: pointer; color: #999; }
    .close:hover { color: #333; }
    .form-group { margin-bottom: 15px; }
    .form-group label { display: block; font-weight: 600; margin-bottom: 5px; color: #555; }
    .form-group input, .form-group select { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 0.9rem; }
    .form-group input[type="checkbox"] { width: auto; margin-right: 8px; }
    .checkbox-label { display: flex; align-items: center; }
    .save-btn { width: 100%; padding: 12px; background: #28a745; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 1rem; font-weight: bold; margin-top: 10px; }
    .save-btn:hover { background: #218838; }
    .status-message { padding: 10px; border-radius: 5px; margin-top: 15px; text-align: center; display: none; }
    .status-message.success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
    .status-message.error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
    .no-data { text-align: center; padding: 40px; color: #999; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header with logo and menu -->
    <header>
      <div class="logo-section">
        <img src="https://udaproperty.com.my/sites/default/files/styles/project_logo/public/node/project/images/2022-12/Evoke_1.png?itok=MIgcniXd" alt="Evoke Logo" class="logo">
        <h1 class="brand-text">EvokePass - Door Config</h1>
      </div>
      <div class="nav-menu">
        <a href="/">📊 Dashboard</a>
        <button onclick="toggleSettings()">⚙️ Publish Config</button>
        <a href="/config/doors" class="active">🚪 Door Config</a>
      </div>
    </header>
    
    <div class="content">
    <div class="controls">
      <div>
        <strong>Total Doors Configured: <span id="door-count">0</span></strong>
      </div>
      <button class="add-btn" onclick="showAddModal()">➕ Add Door Configuration</button>
    </div>
    
    <div class="table-container">
      <div style="overflow-x: auto; max-height: 600px; overflow-y: auto;">
        <table id="doors-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Door Name (DEVNAME)</th>
              <th>Camera IP</th>
              <th>Port</th>
              <th>Username</th>
              <th>ONVIF</th>
              <th>Stream URL</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="doors-body">
            <tr><td colspan="8" class="no-data">Loading door configurations...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
  
  <!-- Modal for Add/Edit -->
  <div id="doorModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="modal-title">Add Door Configuration</h2>
        <span class="close" onclick="closeModal()">&times;</span>
      </div>
      <form id="door-form">
        <input type="hidden" id="door-id">
        <div class="form-group">
          <label>Door Name (DEVNAME) *</label>
          <input type="text" id="door-devname" required placeholder="e.g., Barrier GateIN">
        </div>
        <div class="form-group">
          <label>Camera IP Address *</label>
          <input type="text" id="door-ip" required placeholder="192.168.1.100">
        </div>
        <div class="form-group">
          <label>Camera Port</label>
          <input type="number" id="door-port" value="80" placeholder="80">
        </div>
        <div class="form-group">
          <label>Camera Username *</label>
          <input type="text" id="door-username" required placeholder="admin">
        </div>
        <div class="form-group">
          <label>Camera Password *</label>
          <input type="password" id="door-password" required placeholder="password">
        </div>
        <div class="form-group">
          <label>Stream URL (RTSP)</label>
          <input type="text" id="door-stream" placeholder="rtsp://192.168.1.100:554/stream1">
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="door-onvif" checked>
            Enable ONVIF
          </label>
        </div>
        <button type="submit" class="save-btn">💾 Save Configuration</button>
        <div id="modal-status" class="status-message"></div>
      </form>
    </div>
  </div>
  
  <script>
    let currentEditId = null;
    
    function showAddModal() {
      currentEditId = null;
      document.getElementById('modal-title').textContent = 'Add Door Configuration';
      document.getElementById('door-form').reset();
      document.getElementById('door-id').value = '';
      document.getElementById('doorModal').style.display = 'block';
    }
    
    function showEditModal(door) {
      currentEditId = door.id;
      document.getElementById('modal-title').textContent = 'Edit Door Configuration';
      document.getElementById('door-id').value = door.id || '';
      document.getElementById('door-devname').value = door.devname;
      document.getElementById('door-ip').value = door.camera_ip;
      document.getElementById('door-port').value = door.camera_port;
      document.getElementById('door-username').value = door.camera_username;
      document.getElementById('door-password').value = door.camera_password;
      document.getElementById('door-stream').value = door.stream_url || '';
      document.getElementById('door-onvif').checked = door.onvif_enabled;
      document.getElementById('doorModal').style.display = 'block';
    }
    
    function closeModal() {
      document.getElementById('doorModal').style.display = 'none';
      document.getElementById('modal-status').style.display = 'none';
    }
    
    function toggleSettings() {
      window.location.href = '/';
    }
    
    async function loadDoors() {
      try {
        const response = await fetch('/api/door-cameras');
        const data = await response.json();
        
        if (data.success) {
          document.getElementById('door-count').textContent = data.count;
          const tbody = document.getElementById('doors-body');
          
          if (data.count === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="no-data">No door configurations yet. Click "Add Door Configuration" to get started.</td></tr>';
            return;
          }
          
          tbody.innerHTML = data.data.map(door => \`
            <tr>
              <td>#\${door.id}</td>
              <td><strong>\${door.devname}</strong></td>
              <td>\${door.camera_ip}</td>
              <td>\${door.camera_port}</td>
              <td>\${door.camera_username}</td>
              <td>\${door.onvif_enabled ? '✅ Yes' : '❌ No'}</td>
              <td>\${door.stream_url ? '<a href="' + door.stream_url + '" target="_blank" class="stream-button">📹 Live</a>' : '-'}</td>
              <td class="actions">
                <button class="edit-btn" onclick='showEditModal(\${JSON.stringify(door)})'>✏️ Edit</button>
                <button class="test-btn" onclick="testSnapshot('\${door.devname}')" title="Test snapshot capture">📸 Test</button>
                <button class="delete-btn" onclick="deleteDoor('\${door.devname}')">🗑️ Delete</button>
              </td>
            </tr>
          \`).join('');
        }
      } catch (error) {
        console.error('Failed to load doors:', error);
        document.getElementById('doors-body').innerHTML = 
          '<tr><td colspan="8" class="no-data">Error loading doors. Make sure the server is running.</td></tr>';
      }
    }
    
    document.getElementById('door-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const doorData = {
        devname: document.getElementById('door-devname').value,
        camera_ip: document.getElementById('door-ip').value,
        camera_port: parseInt(document.getElementById('door-port').value),
        camera_username: document.getElementById('door-username').value,
        camera_password: document.getElementById('door-password').value,
        stream_url: document.getElementById('door-stream').value || undefined,
        onvif_enabled: document.getElementById('door-onvif').checked
      };
      
      try {
        const response = await fetch('/api/door-cameras', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(doorData)
        });
        
        const data = await response.json();
        
        if (data.success) {
          showModalStatus('✅ Configuration saved successfully!', 'success');
          setTimeout(() => {
            closeModal();
            loadDoors();
          }, 1500);
        } else {
          showModalStatus('❌ Failed to save: ' + (data.error || 'Unknown error'), 'error');
        }
      } catch (error) {
        showModalStatus('❌ Failed to save configuration: ' + error.message, 'error');
      }
    });
    
    async function deleteDoor(devname) {
      if (!confirm(\`Are you sure you want to delete the configuration for "\${devname}"?\`)) {
        return;
      }
      
      try {
        const response = await fetch('/api/door-cameras/' + encodeURIComponent(devname), {
          method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
          loadDoors();
        } else {
          alert('Failed to delete: ' + (data.error || 'Unknown error'));
        }
      } catch (error) {
        alert('Failed to delete configuration: ' + error.message);
      }
    }
    
    async function testSnapshot(devname) {
      if (!confirm(\`Test snapshot capture for "\${devname}"?\`)) return;
      
      try {
        const response = await fetch(\`/api/test-snapshot/\${encodeURIComponent(devname)}\`, {
          method: 'POST'
        });
        const data = await response.json();
        
        if (data.success) {
          const snapshotUrl = \`/snapshots/\${data.imagePath}\`;
          const streamInfo = data.streamUrl ? \`\\n\\nStream URL: \${data.streamUrl}\` : '';
          alert(\`✅ Snapshot captured successfully!\\n\\nImage: \${data.imagePath}\${streamInfo}\`);
          
          // Open the captured snapshot in a new tab
          window.open(snapshotUrl, '_blank');
        } else {
          const streamInfo = data.streamUrl ? \`\\n\\nStream URL available: \${data.streamUrl}\` : '';
          alert(\`❌ Snapshot capture failed:\\n\${data.error}\${streamInfo}\`);
        }
      } catch (error) {
        alert('Failed to test snapshot: ' + error.message);
      }
    }
    
    function showModalStatus(message, type) {
      const statusDiv = document.getElementById('modal-status');
      statusDiv.textContent = message;
      statusDiv.className = 'status-message ' + type;
      statusDiv.style.display = 'block';
    }
    
    // Load doors on page load
    loadDoors();
  </script>
  
  <footer>
    <p>&copy; 2022-2025 EvokePass. All Rights Reserved.</p>
  </footer>
</body>
</html>`);
});

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EvokePass - Access Control Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 0; }
    .container { max-width: 100%; margin: 0 auto; }
    
    /* Header with logo on left and menu */
    header { background: white; padding: 10px 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; }
    .logo-section { display: flex; align-items: center; gap: 15px; }
    .logo { max-width: 80px; height: auto; }
    .brand-text { font-size: 1.3rem; font-weight: bold; color: #667eea; margin: 0; }
    
    /* Navigation Menu */
    .nav-menu { display: flex; gap: 5px; align-items: center; }
    .nav-menu a, .nav-menu button { padding: 8px 16px; background: #667eea; color: white; text-decoration: none; border: none; border-radius: 5px; font-weight: 600; font-size: 0.9rem; cursor: pointer; transition: background 0.3s; }
    .nav-menu a:hover, .nav-menu button:hover { background: #5568d3; }
    .nav-menu a.active { background: #5568d3; }
    
    /* Refresh button */
    .refresh-btn-small { padding: 6px 12px; background: #28a745; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 0.85rem; margin-left: 10px; }
    .refresh-btn-small:hover { background: #218838; }
    
    /* Source host status alert */
    .host-status { padding: 15px 20px; margin: 20px; border-radius: 8px; font-weight: bold; font-size: 1.1rem; text-align: center; display: none; }
    .host-status.online { background: #d4edda; color: #155724; border: 2px solid #28a745; }
    .host-status.offline { background: #f8d7da; color: #721c24; border: 3px solid #dc3545; animation: blink 1s infinite; display: block !important; }
    @keyframes blink { 0%, 50%, 100% { opacity: 1; } 25%, 75% { opacity: 0.5; } }
    
    /* Content area */
    .content { padding: 20px; }
    /* Content area */
    .content { padding: 20px; }
    
    .controls { background: white; padding: 15px 20px; border-radius: 10px; margin-bottom: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .table-container { background: white; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); overflow: hidden; }
    .filters { padding: 15px; background: #f8f9fa; border-bottom: 2px solid #e9ecef; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
    .filter-input { padding: 8px 12px; border: 1px solid #ddd; border-radius: 5px; font-size: 0.9rem; width: 100%; }
    .filter-input:focus { outline: none; border-color: #667eea; }
    table { width: 100%; border-collapse: collapse; }
    thead { background: #667eea; color: white; position: sticky; top: 0; z-index: 10; }
    th { padding: 15px 12px; text-align: left; font-weight: 600; font-size: 0.9rem; white-space: nowrap; }
    tbody tr { border-bottom: 1px solid #e9ecef; transition: background 0.2s; }
    tbody tr:hover { background: #f8f9fa; }
    tbody tr.violation { background: #fff5f5; }
    tbody tr.violation:hover { background: #ffe5e5; }
    td { padding: 12px; font-size: 0.9rem; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 0.8rem; font-weight: bold; }
    .badge.success { background: #e8f5e9; color: #2e7d32; }
    .badge.violation { background: #ffebee; color: #c62828; }
    .snapshot-thumb { width: 60px; height: 45px; object-fit: cover; border-radius: 4px; cursor: pointer; }
    .stream-icon { color: #667eea; text-decoration: none; font-size: 1.2rem; }
    .stream-button { 
      display: inline-block;
      padding: 4px 10px; 
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white; 
      text-decoration: none; 
      border-radius: 4px; 
      font-size: 0.85rem;
      font-weight: 500;
      transition: all 0.2s;
    }
    .stream-button:hover { 
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(102, 126, 234, 0.3);
    }
    .no-data { text-align: center; padding: 40px; color: #999; }
    .settings-panel { background: white; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); padding: 20px; margin-bottom: 20px; display: none; }
    .settings-panel.show { display: block; }
    .settings-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
    .settings-header h2 { font-size: 1.5rem; color: #333; }
    .toggle-btn { padding: 8px 16px; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 0.9rem; }
    .toggle-btn:hover { background: #5568d3; }
    .settings-content { display: block; margin-top: 15px; }
    .settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .settings-section { background: #f8f9fa; padding: 15px; border-radius: 8px; }
    .settings-section h3 { font-size: 1.1rem; color: #667eea; margin-bottom: 15px; }
    .form-group { margin-bottom: 15px; }
    .form-group label { display: block; font-weight: 600; margin-bottom: 5px; color: #555; font-size: 0.9rem; }
    .form-group input[type="text"], .form-group input[type="number"] { width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 5px; font-size: 0.9rem; }
    .form-group input[type="checkbox"] { margin-right: 8px; width: auto; }
    .form-group select { width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 5px; font-size: 0.9rem; }
    .checkbox-label { display: flex; align-items: center; font-weight: 600; color: #555; font-size: 0.9rem; }
    .staff-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .staff-tag { background: #667eea; color: white; padding: 5px 10px; border-radius: 15px; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 5px; }
    .staff-tag .remove { cursor: pointer; font-weight: bold; }
    .add-staff-group { display: flex; gap: 8px; margin-top: 10px; }
    .add-staff-group input { flex: 1; padding: 8px 12px; border: 1px solid #ddd; border-radius: 5px; font-size: 0.9rem; }
    .add-staff-group button { padding: 8px 16px; background: #28a745; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
    .add-staff-group button:hover { background: #218838; }
    .save-config-btn { width: 100%; padding: 12px; background: #28a745; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 1rem; font-weight: bold; margin-top: 20px; }
    .save-config-btn:hover { background: #218838; }
    .status-message { padding: 10px; border-radius: 5px; margin-top: 15px; text-align: center; display: none; }
    .status-message.success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
    .status-message.error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
    
    /* Footer */
    footer { background: rgba(255,255,255,0.95); padding: 15px 0; margin-top: 40px; text-align: center; box-shadow: 0 -2px 10px rgba(0,0,0,0.1); }
    footer p { color: #666; font-size: 0.9rem; margin: 0; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header with logo and menu -->
    <header>
      <div class="logo-section">
        <img src="https://udaproperty.com.my/sites/default/files/styles/project_logo/public/node/project/images/2022-12/Evoke_1.png?itok=MIgcniXd" alt="Evoke Logo" class="logo">
        <h1 class="brand-text">EvokePass</h1>
      </div>
      <div class="nav-menu">
        <a href="/" class="active">📊 Dashboard</a>
        <button onclick="toggleSettings()">⚙️ Publish Config</button>
        <a href="/config/doors">🚪 Door Config</a>
        <button class="refresh-btn-small" onclick="loadEvents()">🔄 Refresh</button>
      </div>
    </header>
    
    <!-- Host Status Alert -->
    <div class="host-status" id="host-status">
      ⚠️ WARNING: OFFICE ENTRYPASS SERVER is OFFLINE! No data is being received.
    </div>
    
    <div class="content">
      <!-- Settings Panel -->
      <div class="settings-panel" id="settings-panel">
      <div class="settings-header">
        <h2>⚙️ Publish Configuration</h2>
      </div>
      <div class="settings-content" id="settings-content">
        <div class="settings-grid">
          <div class="settings-section">
            <h3>📤 Event Forwarding</h3>
            <div class="form-group">
              <label class="checkbox-label">
                <input type="checkbox" id="fwd-enabled" onchange="updateForwardingState()">
                Enable Event Forwarding
              </label>
            </div>
            <div id="fwd-fields">
              <div class="form-group">
                <label>Destination Host</label>
                <input type="text" id="fwd-host" placeholder="192.168.1.100">
              </div>
              <div class="form-group">
                <label>Destination Port</label>
                <input type="number" id="fwd-port" placeholder="4000">
              </div>
              <div class="form-group">
                <label>Protocol</label>
                <select id="fwd-protocol">
                  <option value="tcp">TCP</option>
                  <option value="http">HTTP</option>
                </select>
              </div>
              <div class="form-group">
                <label>Timeout (ms)</label>
                <input type="number" id="fwd-timeout" placeholder="5000">
              </div>
              <div class="form-group">
                <label>Retry Attempts</label>
                <input type="number" id="fwd-retry" placeholder="3">
              </div>
              <div class="form-group">
                <label>Device Filter (forward only these devices)</label>
                <input type="text" id="fwd-device-input" placeholder="e.g., Barrier GateIN">
                <div class="device-list" id="device-list" style="margin-top: 10px;"></div>
                <button type="button" onclick="addDeviceFilter()" style="margin-top: 5px; padding: 6px 12px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;">➕ Add Device</button>
                <small style="color: #999; font-size: 0.85rem; display: block; margin-top: 5px;">Leave empty to forward ALL devices</small>
              </div>
            </div>
          </div>
          <div class="settings-section">
            <h3>� Host Monitoring</h3>
            <div class="form-group">
              <label class="checkbox-label">
                <input type="checkbox" id="monitor-enabled" onchange="updateMonitoringState()">
                Enable Host Status Monitoring
              </label>
            </div>
            <div id="monitor-fields">
              <div class="form-group">
                <label>Source Host IP</label>
                <input type="text" id="monitor-host" placeholder="192.168.1.99">
              </div>          
              <div class="form-group">
                <label>Timeout (seconds)</label>
                <input type="number" id="monitor-timeout" placeholder="30">
                <small style="color: #999; font-size: 0.85rem;">Alert if no events received for this duration</small>
              </div>
            </div>
          </div>
        </div>
        <div class="settings-grid">
          <div class="settings-section">
            <h3>�🚫 Staff Filtering</h3>
            <div class="form-group">
              <label class="checkbox-label">
                <input type="checkbox" id="filter-enabled" onchange="updateFilteringState()">
                Enable Staff Filtering (for forwarding only)
              </label>
            </div>
            <div id="filter-fields">
              <div class="form-group">
                <label>Skip Staff Numbers (events will still be stored, but not forwarded)</label>
                <div class="staff-list" id="staff-list"></div>
                <div class="add-staff-group">
                  <input type="text" id="new-staff-no" placeholder="Enter staff number...">
                  <button onclick="addStaffNumber()">➕ Add</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <button class="save-config-btn" onclick="saveConfiguration()">💾 Save Configuration</button>
        <div id="status-message" class="status-message"></div>
      </div>
    </div>
    
    <!-- Events Table -->
    <div class="table-container">
      <div class="filters">
        <input type="text" class="filter-input" id="filter-id" placeholder="Filter ID..." onkeyup="filterTable()">
        <input type="text" class="filter-input" id="filter-type" placeholder="Filter Type..." onkeyup="filterTable()">
        <input type="text" class="filter-input" id="filter-desc" placeholder="Filter Description..." onkeyup="filterTable()">
        <input type="text" class="filter-input" id="filter-staff" placeholder="Filter Staff Name..." onkeyup="filterTable()">
        <input type="text" class="filter-input" id="filter-staffno" placeholder="Filter Staff No..." onkeyup="filterTable()">
        <input type="text" class="filter-input" id="filter-cardno" placeholder="Filter Card No..." onkeyup="filterTable()">
        <input type="text" class="filter-input" id="filter-device" placeholder="Filter Device..." onkeyup="filterTable()">
      </div>
      <div class="date-range-filter" style="padding: 15px; background: #f0f4ff; border-bottom: 2px solid #667eea; display: flex; gap: 15px; align-items: center; flex-wrap: wrap;">
        <label style="font-weight: 600; color: #667eea;">📅 Date Range Filter:</label>
        <div style="display: flex; gap: 10px; align-items: center;">
          <label style="font-size: 0.9rem; color: #555;">From:</label>
          <input type="datetime-local" class="filter-input" id="filter-date-from" onchange="filterTable()" style="width: 200px;">
        </div>
        <div style="display: flex; gap: 10px; align-items: center;">
          <label style="font-size: 0.9rem; color: #555;">To:</label>
          <input type="datetime-local" class="filter-input" id="filter-date-to" onchange="filterTable()" style="width: 200px;">
        </div>
        <button onclick="clearDateRange()" style="padding: 8px 16px; background: #dc3545; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: 600; font-size: 0.85rem;">🗑️ Clear</button>
        <button onclick="setToday()" style="padding: 8px 16px; background: #28a745; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: 600; font-size: 0.85rem;">📆 Today</button>
        <button onclick="setYesterday()" style="padding: 8px 16px; background: #17a2b8; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: 600; font-size: 0.85rem;">📆 Yesterday</button>
        <button onclick="setLastWeek()" style="padding: 8px 16px; background: #6c757d; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: 600; font-size: 0.85rem;">📆 Last 7 Days</button>
      </div>
      <div style="padding: 15px; background: #f8f9fa; border-bottom: 2px solid #e9ecef; display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; gap: 10px; align-items: center;">
          <span style="font-weight: 600; color: #555;">Showing <span id="showing-count">0</span> of <span id="filtered-count">0</span> events</span>
        </div>
        <div style="display: flex; gap: 10px; align-items: center;">
          <button onclick="previousPage()" id="prev-btn" style="padding: 8px 16px; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: 600;">◀ Previous</button>
          <span style="font-weight: 600; color: #555;">Page <span id="current-page">1</span> of <span id="total-pages">1</span></span>
          <button onclick="nextPage()" id="next-btn" style="padding: 8px 16px; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: 600;">Next ▶</button>
        </div>
      </div>
      <div style="overflow-x: auto; max-height: 600px; overflow-y: auto;">
        <table id="events-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Type</th>
              <th>Description</th>
              <th>Staff Name</th>
              <th>Staff No</th>
              <th>Card No</th>
              <th>Device</th>
              <th>Date</th>
              <th>Time</th>
              <th>Recorded</th>
              <th>Snapshot</th>
              <th>Stream</th>
            </tr>
          </thead>
          <tbody id="events-body">
            <tr><td colspan="12" class="no-data">Loading events...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
  <script>
    let allEvents = [];
    let filteredEvents = [];
    let currentConfig = null;
    let skipStaffList = [];
    let currentPage = 1;
    const eventsPerPage = 100;
    let SOURCE_HOST = '192.168.1.99';
    let MONITOR_ENABLED = true;
    let MONITOR_TIMEOUT = 30000; // milliseconds
    let hostOnline = true;
    let lastEventTime = Date.now();
    
    // Monitor source host connectivity
    function checkSourceHost() {
      if (!MONITOR_ENABLED) {
        // If monitoring is disabled, hide alert and exit
        hideHostOfflineAlert();
        return;
      }
      
      const now = Date.now();
      const timeSinceLastEvent = now - lastEventTime;
      
      // If no events received for configured timeout, consider host offline
      if (timeSinceLastEvent > MONITOR_TIMEOUT) {
        if (hostOnline) {
          hostOnline = false;
          showHostOfflineAlert();
        }
      } else {
        if (!hostOnline) {
          hostOnline = true;
          hideHostOfflineAlert();
        }
      }
    }
    
    function showHostOfflineAlert() {
      const alert = document.getElementById('host-status');
      alert.className = 'host-status offline';
      alert.style.display = 'block';
      console.error('SOURCE HOST OFFLINE:', SOURCE_HOST);
    }
    
    function hideHostOfflineAlert() {
      const alert = document.getElementById('host-status');
      alert.className = 'host-status online';
      alert.style.display = 'none';
      console.log('Source host back online:', SOURCE_HOST);
    }
    
    // Check host status every 5 seconds
    setInterval(checkSourceHost, 5000);
    
    function toggleSettings() {
      const panel = document.getElementById('settings-panel');
      panel.classList.toggle('show');
    }
    
    function updateForwardingState() {
      const enabled = document.getElementById('fwd-enabled').checked;
      const fields = document.getElementById('fwd-fields');
      fields.style.opacity = enabled ? '1' : '0.5';
      fields.style.pointerEvents = enabled ? 'auto' : 'none';
    }
    
    function updateMonitoringState() {
      const enabled = document.getElementById('monitor-enabled').checked;
      const fields = document.getElementById('monitor-fields');
      fields.style.opacity = enabled ? '1' : '0.5';
      fields.style.pointerEvents = enabled ? 'auto' : 'none';
    }
    
    function updateFilteringState() {
      const enabled = document.getElementById('filter-enabled').checked;
      const fields = document.getElementById('filter-fields');
      fields.style.opacity = enabled ? '1' : '0.5';
      fields.style.pointerEvents = enabled ? 'auto' : 'none';
    }
    
    function renderStaffList() {
      const container = document.getElementById('staff-list');
      if (skipStaffList.length === 0) {
        container.innerHTML = '<div style="color: #999; font-size: 0.9rem; padding: 10px;">No staff numbers configured</div>';
        return;
      }
      
      container.innerHTML = skipStaffList.map((staffNo, index) => \`
        <div class="staff-tag">
          <span>\${staffNo}</span>
          <span class="remove" onclick="removeStaffNumber(\${index})">×</span>
        </div>
      \`).join('');
    }
    
    function addStaffNumber() {
      const input = document.getElementById('new-staff-no');
      const staffNo = input.value.trim();
      
      if (!staffNo) {
        showStatus('Please enter a staff number', 'error');
        return;
      }
      
      if (skipStaffList.includes(staffNo)) {
        showStatus('Staff number already exists', 'error');
        return;
      }
      
      skipStaffList.push(staffNo);
      input.value = '';
      renderStaffList();
    }
    
    function removeStaffNumber(index) {
      skipStaffList.splice(index, 1);
      renderStaffList();
    }
    
    let deviceFilterList = [];
    
    function addDeviceFilter() {
      const input = document.getElementById('fwd-device-input');
      const deviceName = input.value.trim();
      
      if (!deviceName) {
        showStatus('Please enter a device name', 'error');
        return;
      }
      
      if (deviceFilterList.includes(deviceName)) {
        showStatus('Device already exists in filter list', 'error');
        return;
      }
      
      deviceFilterList.push(deviceName);
      input.value = '';
      renderDeviceList();
    }
    
    function removeDevice(index) {
      deviceFilterList.splice(index, 1);
      renderDeviceList();
    }
    
    function renderDeviceList() {
      const container = document.getElementById('device-list');
      if (deviceFilterList.length === 0) {
        container.innerHTML = '<p style="color: #999; font-size: 0.9rem; font-style: italic;">No device filters - will forward ALL devices</p>';
        return;
      }
      
      container.innerHTML = deviceFilterList.map((device, index) => \`
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #e8f5e9; border-radius: 4px; margin-bottom: 5px;">
          <span style="color: #2e7d32; font-weight: 500;">\${device}</span>
          <button onclick="removeDevice(\${index})" style="background: #dc3545; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 0.85rem;">✖ Remove</button>
        </div>
      \`).join('');
    }
    
    async function loadConfiguration() {
      try {
        const response = await fetch('/api/config');
        const data = await response.json();
        
        if (data.success) {
          currentConfig = data.data;
          
          // Populate forwarding settings
          document.getElementById('fwd-enabled').checked = currentConfig.forwarding?.enabled || false;
          document.getElementById('fwd-host').value = currentConfig.forwarding?.destinationHost || '';
          document.getElementById('fwd-port').value = currentConfig.forwarding?.destinationPort || '';
          document.getElementById('fwd-protocol').value = currentConfig.forwarding?.protocol || 'tcp';
          document.getElementById('fwd-timeout').value = currentConfig.forwarding?.timeout || 5000;
          document.getElementById('fwd-retry').value = currentConfig.forwarding?.retryAttempts || 3;
          deviceFilterList = currentConfig.forwarding?.filterDevices || [];
          
          // Populate monitoring settings
          document.getElementById('monitor-enabled').checked = currentConfig.monitoring?.enabled !== false;
          document.getElementById('monitor-host').value = currentConfig.monitoring?.sourceHost || '192.168.1.99';
          document.getElementById('monitor-timeout').value = currentConfig.monitoring?.timeoutSeconds || 30;
          
          // Update global monitoring variables
          MONITOR_ENABLED = currentConfig.monitoring?.enabled !== false;
          SOURCE_HOST = currentConfig.monitoring?.sourceHost || '192.168.1.99';
          MONITOR_TIMEOUT = (currentConfig.monitoring?.timeoutSeconds || 30) * 1000;
          
          // Populate filtering settings
          document.getElementById('filter-enabled').checked = currentConfig.filtering?.enabled || false;
          skipStaffList = currentConfig.filtering?.skipStaffNumbers || [];
          
          updateForwardingState();
          updateMonitoringState();
          updateFilteringState();
          renderStaffList();
          renderDeviceList();
        }
      } catch (error) {
        console.error('Failed to load configuration:', error);
      }
    }
    
    async function saveConfiguration() {
      try {
        const updatedConfig = {
          forwarding: {
            enabled: document.getElementById('fwd-enabled').checked,
            destinationHost: document.getElementById('fwd-host').value,
            destinationPort: parseInt(document.getElementById('fwd-port').value),
            protocol: document.getElementById('fwd-protocol').value,
            timeout: parseInt(document.getElementById('fwd-timeout').value),
            retryAttempts: parseInt(document.getElementById('fwd-retry').value),
            filterDevices: deviceFilterList
          },
          monitoring: {
            enabled: document.getElementById('monitor-enabled').checked,
            sourceHost: document.getElementById('monitor-host').value,
            timeoutSeconds: parseInt(document.getElementById('monitor-timeout').value)
          },
          filtering: {
            enabled: document.getElementById('filter-enabled').checked,
            skipStaffNumbers: skipStaffList
          }
        };
        
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedConfig)
        });
        
        const data = await response.json();
        
        if (data.success) {
          showStatus('✅ Configuration saved successfully!', 'success');
          currentConfig = updatedConfig;
          
          // Update global monitoring variables
          MONITOR_ENABLED = updatedConfig.monitoring.enabled;
          SOURCE_HOST = updatedConfig.monitoring.sourceHost;
          MONITOR_TIMEOUT = updatedConfig.monitoring.timeoutSeconds * 1000;
          
          // Reset host online state and hide alert if monitoring disabled
          if (!MONITOR_ENABLED) {
            hideHostOfflineAlert();
          }
        } else {
          showStatus('❌ Failed to save: ' + (data.error || 'Unknown error'), 'error');
        }
      } catch (error) {
        showStatus('❌ Failed to save configuration: ' + error.message, 'error');
      }
    }
    
    function showStatus(message, type) {
      const statusDiv = document.getElementById('status-message');
      statusDiv.textContent = message;
      statusDiv.className = 'status-message ' + type;
      statusDiv.style.display = 'block';
      
      setTimeout(() => {
        statusDiv.style.display = 'none';
      }, 5000);
    }
    
    function formatTime(time) {
      if (!time) return '';
      return time.slice(0,2) + ':' + time.slice(2,4) + ':' + time.slice(4,6);
    }
    
    function formatDate(date) {
      if (!date) return '';
      const year = date.slice(0,4);
      const month = date.slice(4,6);
      const day = date.slice(6,8);
      return \`\${day}/\${month}/\${year}\`;
    }
    
    function isViolation(trdesc) {
      const keywords = ['violation', 'denied', 'failed', 'rejected', 'left open', 'disabled', 'forced open', 'invalid'];
      return keywords.some(k => trdesc.toLowerCase().includes(k));
    }
    
    function filterTable() {
      const filterId = document.getElementById('filter-id').value.toLowerCase();
      const filterType = document.getElementById('filter-type').value.toLowerCase();
      const filterDesc = document.getElementById('filter-desc').value.toLowerCase();
      const filterStaff = document.getElementById('filter-staff').value.toLowerCase();
      const filterStaffNo = document.getElementById('filter-staffno').value.toLowerCase();
      const filterCardNo = document.getElementById('filter-cardno').value.toLowerCase();
      const filterDevice = document.getElementById('filter-device').value.toLowerCase();
      const filterDateFrom = document.getElementById('filter-date-from').value;
      const filterDateTo = document.getElementById('filter-date-to').value;
      
      console.log('🔍 Filtering - Total events:', allEvents.length);
      
      // Filter events based on criteria
      filteredEvents = allEvents.filter(event => {
        const matchId = String(event.id).toLowerCase().includes(filterId);
        const matchType = event.etype.toLowerCase().includes(filterType);
        const matchDesc = event.trdesc.toLowerCase().includes(filterDesc);
        const matchStaff = event.staffname.toLowerCase().includes(filterStaff);
        const matchStaffNo = event.staffno.toLowerCase().includes(filterStaffNo);
        const matchCardNo = (event.cardno || '').toLowerCase().includes(filterCardNo);
        const matchDevice = event.devname.toLowerCase().includes(filterDevice);
        
        let matchDateRange = true;
        if (filterDateFrom || filterDateTo) {
          // Parse event date and time
          const eventDateStr = event.trdate; // YYYYMMDD
          const eventTimeStr = event.trtime; // HHMMSS
          const eventYear = eventDateStr.substring(0, 4);
          const eventMonth = eventDateStr.substring(4, 6);
          const eventDay = eventDateStr.substring(6, 8);
          const eventHour = eventTimeStr.substring(0, 2);
          const eventMin = eventTimeStr.substring(2, 4);
          const eventSec = eventTimeStr.substring(4, 6);
          
          // Create datetime string: YYYY-MM-DDTHH:MM:SS
          const eventDateTime = \`\${eventYear}-\${eventMonth}-\${eventDay}T\${eventHour}:\${eventMin}:\${eventSec}\`;
          const eventTimestamp = new Date(eventDateTime).getTime();
          
          // Check date range
          if (filterDateFrom) {
            const fromTimestamp = new Date(filterDateFrom).getTime();
            if (eventTimestamp < fromTimestamp) {
              matchDateRange = false;
            }
          }
          
          if (filterDateTo && matchDateRange) {
            const toTimestamp = new Date(filterDateTo).getTime();
            if (eventTimestamp > toTimestamp) {
              matchDateRange = false;
            }
          }
        }
        
        return matchId && matchType && matchDesc && matchStaff && matchStaffNo && matchCardNo && matchDevice && matchDateRange;
      });
      
      console.log('✅ Filtered results:', filteredEvents.length);
      
      // Reset to page 1 when filters change
      currentPage = 1;
      renderPage();
    }
    
    function renderPage() {
      const tbody = document.getElementById('events-body');
      const totalPages = Math.ceil(filteredEvents.length / eventsPerPage);
      
      // If current page is beyond total pages, reset to page 1
      if (currentPage > totalPages && totalPages > 0) {
        currentPage = 1;
      }
      
      const start = (currentPage - 1) * eventsPerPage;
      const end = start + eventsPerPage;
      const pageEvents = filteredEvents.slice(start, end);
      
      // Update pagination info
      document.getElementById('showing-count').textContent = pageEvents.length;
      document.getElementById('filtered-count').textContent = filteredEvents.length;
      document.getElementById('current-page').textContent = currentPage;
      document.getElementById('total-pages').textContent = totalPages || 1;
      
      // Enable/disable pagination buttons
      const prevBtn = document.getElementById('prev-btn');
      const nextBtn = document.getElementById('next-btn');
      if (prevBtn) prevBtn.disabled = currentPage === 1;
      if (nextBtn) nextBtn.disabled = currentPage >= totalPages || totalPages === 0;
      
      if (pageEvents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" class="no-data">No events match the filters.</td></tr>';
        return;
      }
      
      tbody.innerHTML = pageEvents.map(event => {
        const isViol = isViolation(event.trdesc);
        const rowClass = isViol ? 'violation' : '';
        const badgeClass = isViol ? 'violation' : 'success';
        
        let snapshotCell = '-';
        if (event.snapshot_path) {
          const snapshotURL = '/snapshots/' + event.snapshot_path.split('/').pop().split('\\\\\\\\').pop();
          snapshotCell = \`<img src="\${snapshotURL}" class="snapshot-thumb" alt="Snapshot" onclick="window.open('\${snapshotURL}', '_blank')" title="Click to view full size">\`;
        }
        
        let streamCell = '-';
        if (event.stream_url) {
          streamCell = \`
            <a href="\${event.stream_url}" class="stream-button" target="_blank" title="Open RTSP stream in player">
              📹 Live
            </a>
          \`;
        }
        
        return \`
          <tr class="\${rowClass}">
            <td>#\${event.id}</td>
            <td><span class="badge \${badgeClass}">\${event.etype}</span></td>
            <td>\${event.trdesc}</td>
            <td>\${event.staffname}</td>
            <td>\${event.staffno}</td>
            <td>\${event.cardno || '-'}</td>
            <td>\${event.devname}</td>
            <td>\${formatDate(event.trdate)}</td>
            <td>\${formatTime(event.trtime)}</td>
            <td>\${new Date(event.timestamp).toLocaleString()}</td>
            <td>\${snapshotCell}</td>
            <td>\${streamCell}</td>
          </tr>
        \`;
      }).join('');
    }
    
    function previousPage() {
      if (currentPage > 1) {
        currentPage--;
        renderPage();
      }
    }
    
    function nextPage() {
      const totalPages = Math.ceil(filteredEvents.length / eventsPerPage);
      if (currentPage < totalPages) {
        currentPage++;
        renderPage();
      }
    }
    
    function clearDateRange() {
      document.getElementById('filter-date-from').value = '';
      document.getElementById('filter-date-to').value = '';
      filterTable();
    }
    
    function setToday() {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0);
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59);
      
      document.getElementById('filter-date-from').value = formatDateTimeLocal(startOfDay);
      document.getElementById('filter-date-to').value = formatDateTimeLocal(endOfDay);
      filterTable();
    }
    
    function setYesterday() {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const startOfDay = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0);
      const endOfDay = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59);
      
      document.getElementById('filter-date-from').value = formatDateTimeLocal(startOfDay);
      document.getElementById('filter-date-to').value = formatDateTimeLocal(endOfDay);
      filterTable();
    }
    
    function setLastWeek() {
      const now = new Date();
      const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const startOfDay = new Date(lastWeek.getFullYear(), lastWeek.getMonth(), lastWeek.getDate(), 0, 0);
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59);
      
      document.getElementById('filter-date-from').value = formatDateTimeLocal(startOfDay);
      document.getElementById('filter-date-to').value = formatDateTimeLocal(endOfDay);
      filterTable();
    }
    
    function formatDateTimeLocal(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return \`\${year}-\${month}-\${day}T\${hours}:\${minutes}\`;
    }
    
    async function loadEvents() {
      try {
        // Build query string based on date filters
        const fromDateInput = document.getElementById('filter-date-from');
        const toDateInput = document.getElementById('filter-date-to');
        const fromDate = fromDateInput ? fromDateInput.value : '';
        const toDate = toDateInput ? toDateInput.value : '';
        
        let url = '/api/events/all';
        const params = new URLSearchParams();
        
        if (fromDate || toDate) {
          // User selected specific date range
          if (fromDate) params.append('fromDate', fromDate);
          if (toDate) params.append('toDate', toDate);
        } else {
          // Default: last 7 days for performance
          params.append('days', '7');
        }
        
        if (params.toString()) {
          url += '?' + params.toString();
        }
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
          allEvents = data.data;
          filteredEvents = data.data;
          
          // Update last event time for host monitoring
          lastEventTime = Date.now();
          
          if (data.count === 0) {
            const tbody = document.getElementById('events-body');
            tbody.innerHTML = '<tr><td colspan="12" class="no-data">No events yet. Send a test event using .\\\\test-event.ps1</td></tr>';
            document.getElementById('showing-count').textContent = '0';
            document.getElementById('filtered-count').textContent = '0';
            return;
          }
          
          // Initial render with pagination
          filterTable();
        }
      } catch (error) {
        console.error('Failed to load events:', error);
        document.getElementById('events-body').innerHTML = 
          '<tr><td colspan="12" class="no-data">Error loading events. Make sure the server is running.</td></tr>';
      }
    }
    
    // Load events on page load
    loadEvents();
    loadConfiguration();
    
    // WebSocket for real-time updates
    let ws;
    
    function connectWebSocket() {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = \`\${wsProtocol}//\${window.location.host}/ws\`;
      
      ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log('✅ WebSocket connected - real-time updates enabled');
      };
      
      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('📨 WebSocket message received:', data);
          
          if (data.type === 'newEvent' && data.data) {
            // Update last event time for host monitoring
            lastEventTime = Date.now();
            
            // Update lastEventId
            if (data.data.id > lastEventId) {
              lastEventId = data.data.id;
            }
            
            // Reload events immediately
            await loadEvents();
            console.log('✅ UI updated instantly via WebSocket');
          } else if (data.type === 'connected') {
            console.log('✅ WebSocket handshake confirmed');
          }
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      };
      
      ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
      };
      
      ws.onclose = () => {
        console.log('⚠️ WebSocket disconnected - reconnecting in 3 seconds...');
        setTimeout(connectWebSocket, 3000);
      };
    }
    
    // Start WebSocket connection
    connectWebSocket();
    
    // Polling mechanism as fallback (reduced to every 5 seconds since WebSocket handles real-time)
    let lastEventId = 0;
    
    async function checkForNewEvents() {
      try {
        const response = await fetch('/api/events?limit=1');
        const result = await response.json();
        
        console.log('Polling check - received:', result);
        
        if (result.success && result.data && result.data.length > 0) {
          const latestEvent = result.data[0];
          
          // If we have a new event (higher ID than last known)
          if (latestEvent.id > lastEventId) {
            console.log('✅ New event detected:', latestEvent.id, '(previous:', lastEventId, ')');
            
            // Update last event time for host monitoring
            lastEventTime = Date.now();
            
            // Update lastEventId BEFORE reloading to prevent duplicate reloads
            lastEventId = latestEvent.id;
            
            // Reload all events to get the latest data
            await loadEvents();
          } else if (lastEventId === 0) {
            // First load - just set the lastEventId without reloading
            lastEventId = latestEvent.id;
            console.log('Initial event ID set to:', lastEventId);
          }
        }
      } catch (error) {
        console.error('Error checking for new events:', error);
      }
    }
    
    // Poll every 5 seconds as fallback (WebSocket provides instant updates)
    setInterval(checkForNewEvents, 5000);
    console.log('Polling started - checking every 5 seconds (WebSocket provides real-time updates)');
  </script>
  
  <footer>
    <p>&copy; 2022-2025 EvokePass. All Rights Reserved.</p>
  </footer>
</body>
</html>`);
});

server.listen(PORT, () => {
  console.log(`Web UI running at http://localhost:${PORT}`);
  console.log(`WebSocket server available at ws://localhost:${PORT}/ws`);
});
