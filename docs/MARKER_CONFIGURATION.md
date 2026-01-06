# Managed Object Marker Configuration

This document describes how to configure the appearance and behavior of markers on the indoor map widget through the `c8y_marker` fragment in your managed objects.

## Overview

The indoor map widget supports extensive customization of device markers through the `c8y_marker` fragment. This fragment allows you to control:

- 🎨 **Visual Styling** (icon, colors, size)
- 🏷️ **Labels** (custom text displayed below markers)
- 💭 **Popups** (custom tooltip content)
- 📍 **Positioning** (via standard `c8y_Position` fragment)

## Basic Structure

Add the `c8y_marker` fragment to your managed object:

```json
{
  "id": "12345",
  "name": "Temperature Sensor A1",
  "type": "c8y_TemperatureSensor",
  "c8y_Position": {
    "lat": 52.5200,
    "lng": 13.4050
  },
  "c8y_marker": {
    "icon": "thermometer",
    "icon_color": "#FF6B35",
    "color": "#2E7D32",
    "size": 40,
    "label": "Temp A1",
    "popup": "<strong>Temperature Sensor</strong><br/>Zone: Production Floor"
  }
}
```

## Configuration Options

### 🎯 Icon Configuration

#### `icon` (string, optional)
Specifies the Cumulocity icon to display in the marker.

**Default Behavior:**
- If not specified, the widget automatically detects the icon based on device type
- Falls back to configured default icon or "location"

**Available Icons:** Use any Cumulocity icon name without the `dlt-c8y-icon-` prefix
- `thermometer` - Temperature sensors
- `droplet` - Humidity sensors  
- `lightbulb-o` - Light sensors
- `eye` - Motion/PIR sensors
- `dashboard` - Accelerometers
- `compass` - Gyroscopes
- `router` - Gateways
- `sensors` - Generic sensors
- `device` - Generic devices
- `location` - Default location marker

**Example:**
```json
"c8y_marker": {
  "icon": "thermometer"
}
```

#### `icon_color` (string, optional)
Color of the icon inside the marker (CSS color value).

**Default:** `#FFFFFF` (white) or calculated color based on measurements

**Examples:**
```json
"c8y_marker": {
  "icon_color": "#FF0000",        // Red
  "icon_color": "#00FF00",        // Green  
  "icon_color": "rgb(255,0,0)",   // RGB notation
  "icon_color": "red"             // Named color
}
```

#### `icon_size` (array, optional)
Size of the icon in pixels `[width, height]`.

**Default:** `[24, 24]` or widget configuration default

**Example:**
```json
"c8y_marker": {
  "icon_size": [32, 32]
}
```

### 🎨 Marker Styling

#### `color` (string, optional)
Background color of the marker circle.

**Default:** `#000000` (black)

**Example:**
```json
"c8y_marker": {
  "color": "#2196F3"  // Material Blue
}
```

#### `size` (number, optional)
Diameter of the marker circle in pixels.

**Default:** `36`

**Example:**
```json
"c8y_marker": {
  "size": 48
}
```

### 🏷️ Label Configuration

#### `label` (string, optional)
Custom text displayed below the marker.

**Default Behavior** (if label not specified):
1. Device name (truncated to 20 characters)
2. Device type 
3. Device ID

**Example:**
```json
"c8y_marker": {
  "label": "Sensor A1"
}
```

**Advanced Label Examples:**
```json
// Zone identifier
"c8y_marker": {
  "label": "Zone A"
}

// Room number
"c8y_marker": {
  "label": "Room 101"
}

// Equipment ID
"c8y_marker": {
  "label": "EQ-001"
}

// Empty string to hide label
"c8y_marker": {
  "label": ""
}
```

### 💭 Popup Configuration

#### `popup` (string, optional)
Custom HTML content for the marker popup tooltip.

**Default Behavior** (if popup not specified):
- Device name, ID, and type
- Action icons for creating alarms, events, and operations

**Features:**
- Supports HTML markup
- Action icons are automatically prepended
- Interactive elements supported

**Example:**
```json
"c8y_marker": {
  "popup": "<div style='font-family: Arial;'><h4 style='color: #1976D2; margin: 0;'>Production Line Sensor</h4><hr style='margin: 5px 0;'><p><strong>Location:</strong> Building A, Floor 2</p><p><strong>Zone:</strong> Manufacturing</p><p><strong>Last Maintenance:</strong> 2024-01-15</p><div style='background: #f5f5f5; padding: 8px; border-radius: 4px; margin-top: 8px;'><small><strong>Status:</strong> <span style='color: green;'>Operational</span></small></div></div>"
}
```

## Complete Configuration Examples

### 🌡️ Temperature Sensor
```json
{
  "id": "temp_sensor_001",
  "name": "Temperature Sensor - Production Line A",
  "type": "c8y_TemperatureSensor",
  "c8y_Position": {
    "lat": 52.5200,
    "lng": 13.4050
  },
  "c8y_marker": {
    "icon": "thermometer",
    "icon_color": "#FFFFFF",
    "color": "#F44336",
    "size": 40,
    "label": "Temp-A1",
    "popup": "<strong>Temperature Sensor</strong><br/>Location: Production Line A<br/>Normal Range: 18-22°C"
  }
}
```

### 💧 Humidity Sensor  
```json
{
  "id": "humid_sensor_001",
  "name": "Humidity Sensor - Server Room",
  "type": "c8y_HumiditySensor", 
  "c8y_Position": {
    "lat": 52.5201,
    "lng": 13.4051
  },
  "c8y_marker": {
    "icon": "droplet",
    "icon_color": "#FFFFFF",
    "color": "#2196F3",
    "size": 36,
    "label": "Server Room",
    "popup": "<div style='text-align: center;'><strong>Environmental Monitor</strong><br/><small>Humidity & Climate Control</small></div>"
  }
}
```

### 🚪 Motion Sensor
```json
{
  "id": "motion_sensor_001", 
  "name": "PIR Motion Sensor - Entrance",
  "type": "c8y_MotionSensor",
  "c8y_Position": {
    "lat": 52.5202,
    "lng": 13.4052
  },
  "c8y_marker": {
    "icon": "eye",
    "icon_color": "#FFD600", 
    "color": "#424242",
    "size": 44,
    "label": "Main Entrance",
    "popup": "<div style='border-left: 4px solid #FF9800; padding-left: 10px;'><strong>Security Sensor</strong><br/>Zone: Entrance Hall<br/>Coverage: 120° field of view</div>"
  }
}
```

### 🌐 Gateway Device
```json
{
  "id": "gateway_001",
  "name": "LoRaWAN Gateway - Building Control",
  "type": "c8y_Gateway",
  "c8y_Position": {
    "lat": 52.5203,
    "lng": 13.4053
  },
  "c8y_marker": {
    "icon": "router",
    "icon_color": "#4CAF50",
    "color": "#263238", 
    "size": 50,
    "label": "Gateway",
    "popup": "<div style='background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 10px; border-radius: 8px; text-align: center;'><h4 style='margin: 0; color: white;'>LoRaWAN Gateway</h4><p style='margin: 5px 0;'>Building Network Hub</p><small>Connected Devices: 24</small></div>"
  }
}
```

## Position Configuration

All markers require the standard Cumulocity position fragment:

```json
"c8y_Position": {
  "lat": 52.5200,    // Latitude (required)
  "lng": 13.4050     // Longitude (required)
}
```

## Widget Configuration Integration

The `c8y_marker` fragment works alongside widget-level configuration:

### Default Icon Mapping
The widget automatically maps device types to appropriate icons:
- `c8y_TemperatureSensor` → `thermometer`
- `c8y_HumiditySensor` → `droplet`  
- `c8y_LightSensor` → `lightbulb-o`
- `c8y_MotionSensor` → `eye`
- `c8y_Gateway` → `router`

### Fallback Behavior
1. Use `c8y_marker.icon` if specified
2. Auto-detect from device type
3. Use widget default icon
4. Use `location` as final fallback

## Best Practices

### 🎨 Visual Consistency
- Use consistent color schemes across similar device types
- Maintain readable contrast between icon and background colors
- Keep marker sizes proportional to map zoom levels

### 🏷️ Label Guidelines  
- Keep labels concise (under 15 characters for best display)
- Use meaningful identifiers (zone names, equipment IDs)
- Consider using empty string `""` to hide labels when not needed

### 💭 Popup Content
- Use semantic HTML structure
- Include relevant operational information
- Keep content scannable with clear hierarchy
- Test popup content at different screen sizes

### 🎯 Performance Considerations
- Avoid overly complex HTML in popup content
- Use CSS classes instead of extensive inline styles when possible
- Consider marker density when choosing sizes

## Troubleshooting

### Marker Not Appearing
- Verify `c8y_Position` fragment is present and valid
- Check that latitude/longitude values are within map bounds
- Ensure device is assigned to correct floor level

### Icon Not Displaying  
- Verify icon name is valid Cumulocity icon (without prefix)
- Check icon_color has sufficient contrast
- Ensure icon_size is reasonable (minimum 16x16 pixels)

### Label Issues
- Labels may be truncated on smaller markers
- Very long labels may overlap with nearby markers
- Empty or whitespace-only labels will use default fallback

### Popup Problems
- Malformed HTML may break popup rendering
- Excessive content may cause performance issues
- Interactive elements in popups require proper event handling

## Migration Guide

### From Basic Markers
If you currently have devices without `c8y_marker` configuration:

1. **Add basic styling:**
   ```json
   "c8y_marker": {
     "icon": "device",
     "color": "#1976D2"
   }
   ```

2. **Add meaningful labels:**
   ```json 
   "c8y_marker": {
     "label": "Zone A1"
   }
   ```

3. **Enhanced popups:**
   ```json
   "c8y_marker": {
     "popup": "<strong>Equipment ID:</strong> EQ-001<br/><strong>Status:</strong> Operational"
   }
   ```

### Updating Existing Configurations
Use the Cumulocity Inventory API to bulk update managed objects:

```javascript
// Example: Update multiple devices with new marker styling
const devices = await client.inventory.list({
  type: 'c8y_TemperatureSensor'
});

for (const device of devices.data) {
  await client.inventory.update({
    id: device.id,
    c8y_marker: {
      icon: 'thermometer',
      icon_color: '#FFFFFF', 
      color: '#F44336',
      size: 40
    }
  });
}
```

---

For additional support or feature requests, please refer to the widget documentation or contact the development team.