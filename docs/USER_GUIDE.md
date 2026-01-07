# Cumulocity Indoor Map Plugin - User Guide

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [Creating Your First Indoor Map](#creating-your-first-indoor-map)
4. [Widget Configuration](#widget-configuration)
5. [Device Management](#device-management)
6. [Zone Management](#zone-management)
7. [Real-Time Data Monitoring](#real-time-data-monitoring)
8. [Advanced Features](#advanced-features)
9. [Troubleshooting](#troubleshooting)

## Introduction

The Cumulocity Indoor Map Plugin transforms how you visualize and monitor your IoT devices within buildings. Whether you're managing sensors in an office building, monitoring equipment in a factory, or tracking assets in a warehouse, this plugin provides an intuitive visual interface overlaid on your actual floor plans.

### What You Can Do

✅ **Visualize Device Locations**: See exactly where your IoT devices are positioned on real floor plans  
✅ **Monitor Real-Time Data**: Watch live sensor readings and status updates  
✅ **Create Custom Zones**: Define areas for grouping and analysis  
✅ **Set Visual Alerts**: Configure color-coded thresholds for instant status recognition  
✅ **Navigate Multi-Level Buildings**: Seamlessly switch between floors  
✅ **Search and Filter**: Quickly find specific devices or types  

### Prerequisites

- Access to a Cumulocity IoT tenant
- Dashboard creation permissions
- IoT devices already registered in your tenant
- Floor plan images (PNG, JPG, or SVG format)

## Getting Started

### Step 1: Adding the Widget

1. Navigate to your Cumulocity **Cockpit** application
2. Go to the dashboard where you want to add the indoor map
3. Click **"Add widget"**
4. Select **"Indoor Map Widget"** from the available widgets
5. Click **"Add"** to create the widget

### Step 2: Initial Configuration

Upon adding the widget, you'll be prompted to configure it. The configuration process involves:

1. **Building Setup**: Create or select an existing building
2. **Floor Plan Upload**: Add floor plan images
3. **Device Assignment**: Position your IoT devices on the map
4. **Data Configuration**: Select which measurements to display

## Creating Your First Indoor Map

### Building Configuration

#### Creating a New Building

1. In the widget configuration, click **"Create New Building"**
2. **Fill in building details**:
   - **Building Name**: Enter a descriptive name (e.g., "Corporate Headquarters")
   - **Location**: Set geographical coordinates (optional but recommended)
   - **Description**: Add any relevant details

3. **Configure building coordinates** (for precise mapping):
   - **Latitude/Longitude**: GPS coordinates of the building
   - **Zoom Level**: Default zoom when loading the map
   - **Rotation Angle**: If your floor plan needs rotation to align with true north

#### Adding Floor Levels

1. Click **"Add Floor Level"**
2. **Enter floor details**:
   - **Floor Name**: (e.g., "Ground Floor", "Level 2", "Basement")
   - **Floor Order**: Sequence for navigation

3. **Upload floor plan image**:
   - Click **"Upload Floor Plan"**
   - Select your floor plan file (PNG, JPG, or SVG)
   - **Image requirements**:
     - Maximum file size: 10MB
     - Recommended resolution: 1920x1080 or higher
     - Clear, high-contrast images work best

4. **Set image coordinates**:
   - Define the real-world boundaries of your floor plan
   - Mark corner coordinates to establish scale

### Device Assignment

#### Positioning Devices on the Map

1. **Select a floor level** from the dropdown
2. **Choose devices to position**:
   - Available devices appear in the left panel
   - These are IoT devices already registered in your Cumulocity tenant

3. **Position devices**:
   - Click on a device in the list to select it
   - Click on the floor plan where you want to place the device
   - A marker will appear at that location
   - **Drag markers** to fine-tune positioning

4. **Verify placement**:
   - Markers show device names and types
   - Colors indicate current status or measurement values

#### Bulk Device Assignment

For multiple devices:

1. Use the **"Auto-assign"** feature (if available)
2. Upload a CSV file with device IDs and coordinates
3. Use the **batch positioning tool** for similar device types

## Widget Configuration

### Measurement Configuration

#### Primary Measurement

1. **Select the main data point** to display on markers:
   - Fragment: The measurement type (e.g., `c8y_Temperature`)
   - Series: Specific value (e.g., `T` for temperature)

2. **Configure display format**:
   - Units (°C, %, ppm, etc.)
   - Decimal places
   - Update frequency

#### Threshold Configuration

Create visual alerts based on measurement values:

1. **Add measurement thresholds**:
   - Click **"Add Threshold"**
   - Set **minimum and maximum values**
   - Choose **colors** for each range

2. **Example threshold setup**:
   ```
   Normal: 18-25°C (Green)
   Warning: 15-18°C or 25-30°C (Yellow)  
   Critical: <15°C or >30°C (Red)
   ```

3. **Event-based thresholds**:
   - Configure alerts based on specific events
   - Set colors for different alarm types

#### Additional Popup Data

Configure extra information shown when clicking markers:

1. **Add popup datapoints**:
   - Select additional measurements to display
   - Set descriptive labels
   - Choose formatting options

2. **Custom popup content**:
   - Add static text or HTML
   - Include device metadata
   - Link to external resources

### Visual Customization

#### Marker Styling

1. **Icon Configuration**:
   - **Use device type icons**: Automatic icons based on device type
   - **Custom icons**: Choose specific icons for devices
   - **Icon size**: Adjust marker size (24px - 48px recommended)

2. **Color Schemes**:
   - Default colors for normal states
   - Threshold-based color coding
   - Custom marker colors per device type

3. **Labels and Text**:
   - Show/hide device names
   - Customize label positioning
   - Set font sizes and styles

## Device Management

### Device Search and Filtering

#### Using the Search Function

1. **Text Search**:
   - Type in the search box to find devices by:
     - Device name
     - Device ID
     - Device type
     - Custom properties

2. **Type Filtering**:
   - Use the type dropdown to filter by device categories
   - Common types: Sensors, Gateways, Controllers

3. **Search Tips**:
   - Search is case-insensitive
   - Partial matches are supported
   - Use wildcards (*) for broad searches

#### Device Information

Click on any marker to view:

- **Basic Info**: Name, ID, type, status
- **Current Measurements**: Real-time values
- **Historical Data**: Link to detailed charts
- **Configuration**: Device settings and metadata
- **Alarms**: Active alerts and notifications

### Device Status Indicators

#### Marker Colors

- **Green**: Normal operation, values within thresholds
- **Yellow**: Warning state, values approaching limits  
- **Red**: Critical state, values exceeding thresholds
- **Gray**: No recent data or device offline
- **Blue**: Device selected or highlighted

#### Status Icons

- **Solid markers**: Device online and reporting
- **Outlined markers**: Device offline or not reporting
- **Blinking markers**: Active alarms or alerts
- **Special symbols**: Custom states via device configuration

## Zone Management

### Creating Zones

Zones help organize devices by functional area, department, or any logical grouping.

#### Drawing Zones

1. **Enable zone creation mode**:
   - Click the **"Create Zone"** button
   - Select **drawing tools** from the toolbar

2. **Draw zone boundaries**:
   - Click to create polygon vertices
   - Double-click to complete the zone
   - Use the **rectangle tool** for simple rectangular zones

3. **Configure zone properties**:
   - **Zone Name**: Descriptive label (e.g., "Server Room", "Production Line A")
   - **Color**: Visual identifier (different colors for different zone types)
   - **Description**: Additional details or purpose

#### Zone Types and Uses

**Common zone applications**:

- **Functional Areas**: Server rooms, meeting rooms, production lines
- **Departments**: Sales, Engineering, Operations
- **Security Zones**: Restricted areas, emergency exits
- **Environmental**: Climate control zones, fire zones
- **Maintenance**: Equipment groups, service areas

### Zone Features

#### Zone Isolation

Focus on specific areas:

1. **Select a zone** by clicking its boundary
2. **Click "Isolate Zone"** to hide all other areas
3. **View only devices** within the selected zone
4. **Exit isolation** by clicking "Show All" or selecting another zone

#### Zone Analytics

- **Device count**: Number of devices in each zone
- **Average values**: Zone-wide measurement averages  
- **Status summary**: Health overview per zone
- **Trend analysis**: Zone performance over time

### Managing Multiple Zones

#### Zone Organization

- **Layer management**: Show/hide different zone types
- **Zone hierarchy**: Parent-child zone relationships  
- **Zone overlap**: Handle devices in multiple zones
- **Bulk operations**: Actions on multiple zones

## Real-Time Data Monitoring

### Live Data Updates

#### Automatic Refresh

The indoor map automatically updates with new measurement data:

- **Real-time streaming**: Live data via WebSocket connections
- **Update frequency**: Configurable (1-60 seconds)
- **Background updates**: Data refreshes even when not actively viewing

#### Visual Indicators

- **Marker animations**: Brief highlight when data updates
- **Value displays**: Current measurements shown on or near markers
- **Timestamp**: Last update time in device popups
- **Status changes**: Immediate visual feedback for threshold violations

### Data Visualization

#### Measurement Display Options

1. **Marker Labels**: Show current values directly on markers
2. **Color Coding**: Threshold-based marker colors  
3. **Size Variation**: Marker size based on measurement values
4. **Trend Arrows**: Direction indicators for changing values

#### Historical Context

- **Hover details**: Recent history on marker hover
- **Trend charts**: Quick trend visualization in popups
- **Comparison data**: Current vs. previous values
- **Time series**: Link to detailed historical charts

### Alerts and Notifications

#### Threshold Alerts

When measurements exceed configured thresholds:

- **Visual alerts**: Marker color changes immediately
- **Popup notifications**: Brief alert messages
- **Sound notifications**: Optional audio alerts
- **Email notifications**: Configure external alerts

#### System Status

- **Connection status**: Monitor real-time data connectivity
- **Data freshness**: Identify stale or delayed data
- **Device health**: Offline or non-responsive devices
- **Performance**: Monitor update rates and response times

## Advanced Features

### Multi-Floor Navigation

#### Floor Switching

- **Floor selector**: Dropdown menu for level selection
- **Quick navigation**: Keyboard shortcuts (↑/↓ arrows)
- **Floor overview**: Mini-map showing all levels
- **Device tracking**: Follow devices across floors

#### Cross-Floor Features

- **Device search**: Find devices on any floor
- **Zone spanning**: Zones that cover multiple levels
- **Elevator tracking**: Devices that move between floors
- **Building overview**: Aggregate statistics across all floors

### URL Sharing and Bookmarks

#### Shareable Links

Create links that preserve:

- **Current floor level**: Direct link to specific floor
- **Zone isolation**: Share isolated zone views  
- **Search filters**: Preserve search and filter states
- **Device selection**: Link directly to specific devices

#### Bookmark Management

- **Favorite views**: Save commonly used configurations
- **Quick access**: One-click navigation to saved views
- **View sharing**: Share bookmarks with team members

### Integration Features

#### External Systems

- **Alarm integration**: Connect to existing alarm systems
- **Maintenance systems**: Link to work order systems  
- **Access control**: Integration with badge/key systems
- **HVAC systems**: Climate control overlays

#### Mobile Access

- **Responsive design**: Works on tablets and phones
- **Touch navigation**: Optimized for touch interfaces
- **Offline capabilities**: View cached data when disconnected
- **Location services**: GPS-based navigation assistance

### Customization Options

#### Advanced Marker Configuration

Use the `c8y_marker` fragment for detailed marker customization:

```json
{
  "c8y_marker": {
    "icon": "sensor",
    "icon_color": "#FF5733",
    "color": "#2ECC71",
    "size": 32,
    "label": "Temp-01",
    "popup": "<b>Temperature Sensor</b><br/>Location: Lab A<br/>Last Maintenance: 2024-01-15"
  }
}
```

#### Custom Styling

- **CSS overrides**: Custom styling for specific needs
- **Theme integration**: Match corporate branding
- **Icon libraries**: Use custom icon sets
- **Animation effects**: Custom marker animations

## Troubleshooting

### Common Issues

#### Map Display Problems

**Problem**: Map appears blank or floor plan doesn't load
- **Check**: Verify floor plan image upload was successful
- **Solution**: Re-upload floor plan with correct file format
- **Alternative**: Check browser developer console for error messages

**Problem**: Markers appear in wrong locations  
- **Check**: Verify building coordinates are correctly set
- **Solution**: Recalibrate building coordinate system
- **Tips**: Use building corners as reference points

#### Data Issues

**Problem**: No real-time data showing
- **Check**: Verify devices are sending measurements
- **Solution**: Check measurement fragment and series configuration
- **Debug**: Test with manual measurement creation

**Problem**: Threshold colors not working
- **Check**: Threshold values and measurement units match
- **Solution**: Verify threshold ranges don't overlap incorrectly
- **Test**: Send test measurements to verify color changes

#### Performance Issues

**Problem**: Map is slow or unresponsive
- **Causes**: Too many devices on single floor, large floor plan images
- **Solutions**: 
  - Use zone isolation to reduce visible devices
  - Optimize floor plan image size
  - Increase update intervals for better performance

**Problem**: Browser crashes with large buildings
- **Solutions**:
  - Use device filtering to reduce load
  - Split large floors into multiple zones
  - Upgrade browser or use Chrome for better performance

### Browser Compatibility

#### Supported Browsers

- **Chrome**: Recommended, full feature support
- **Firefox**: Full support  
- **Safari**: Full support (some limitations on older versions)
- **Edge**: Full support

#### Mobile Devices

- **iOS Safari**: Good support, touch optimized
- **Android Chrome**: Full support
- **Tablet devices**: Optimized for larger screens

### Getting Help

#### Support Resources

- **Documentation**: Comprehensive guides and API docs
- **Community Forum**: User community and developer support
- **Video Tutorials**: Step-by-step setup guides
- **Sample Data**: Example buildings and configurations

#### Reporting Issues

When contacting support, include:

- Browser version and device type
- Screenshot or video of the issue
- Console error messages (if any)
- Building and device configuration details
- Steps to reproduce the problem

## Best Practices

### Setting Up Buildings

1. **Start simple**: Begin with one floor and a few devices
2. **High-quality images**: Use clear, detailed floor plans
3. **Logical naming**: Use consistent naming conventions
4. **Test thoroughly**: Verify device positioning before full deployment

### Device Organization

1. **Group by function**: Organize devices by their purpose
2. **Use zones effectively**: Create meaningful zone boundaries  
3. **Configure thresholds carefully**: Set realistic alert levels
4. **Regular maintenance**: Update device positions as needed

### Performance Optimization

1. **Limit devices per view**: Use filtering for large deployments
2. **Optimize images**: Compress floor plans without losing detail
3. **Use zones**: Break large floors into manageable sections
4. **Monitor update rates**: Balance real-time needs with performance

### Security and Access

1. **Follow tenant permissions**: Respect Cumulocity access controls
2. **Limit sensitive data**: Avoid exposing confidential information
3. **Regular reviews**: Audit device access and positioning
4. **Update regularly**: Keep plugin updated for security patches

---

*For additional help or feature requests, please consult the Technical Documentation or contact your Cumulocity administrator.*