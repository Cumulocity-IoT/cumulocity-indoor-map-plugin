# Cumulocity Indoor Map Plugin - Technical Documentation

## Overview

The Cumulocity Indoor Map Plugin is a comprehensive Angular-based widget that enables visualization of IoT devices and their data points on interactive indoor floor plans. The plugin supports multi-level buildings, real-time data display, custom marker configurations, and zone management.

## Architecture

### Core Components

#### 1. Data Point Indoor Map Component (`DataPointIndoorMapComponent`)
**Location**: `src/app/widget/data-point-indoor-map.component.ts`

The main widget component responsible for:
- Rendering interactive Leaflet maps with custom indoor floor plans
- Managing device markers and their real-time data updates
- Handling floor level navigation
- Providing search and filtering functionality
- Managing zone visualization and isolation

**Key Features**:
- Real-time measurement display with customizable thresholds
- Multi-level building support
- Dynamic marker styling based on device types and states
- Zone creation, editing, and isolation capabilities
- Device search and filtering
- Popup modals for device interactions

#### 2. Building Service (`BuildingService`)
**Location**: `src/app/services/building.service.ts`

Core service for managing building configurations and data:
- Loading and validating building configurations
- Managing floor plan images and metadata
- Handling measurement subscriptions and real-time updates
- Device data retrieval and processing

#### 3. Image Rotate Service (`ImageRotateService`)
**Location**: `src/app/services/image-rotate.service.ts`

Utility service for image manipulation:
- Floor plan rotation capabilities
- Coordinate transformation between image and map coordinates
- Image dimension calculations

### Data Models

#### Building Configuration (`MapConfiguration`)
```typescript
interface MapConfiguration extends IManagedObject {
  id: string;
  type: "c8y_Building";
  coordinates: {
    lat: number;
    lng: number;
    rotationAngle?: number;
    zoomLevel?: number;
    polygonVerticesJson?: string;
  };
  levels: MapConfigurationLevel[];
}
```

#### Level Configuration (`MapConfigurationLevel`)
```typescript
interface MapConfigurationLevel {
  id: string;
  name: string;
  binaryId?: string;
  blob?: Blob;
  imageDetails: {
    dimensions?: { width: number; height: number };
  };
  markerManagedObjects: MarkerManagedObject[];
  zones?: Zone[];
}
```

#### Marker Configuration (`MarkerManagedObject`)
```typescript
interface MarkerManagedObject {
  managedObject: IManagedObject;
  x: number;
  y: number;
  visible: boolean;
  measurements?: { [key: string]: Measurement };
  zones?: string[];
}
```

## Configuration Structure

### Widget Configuration (`WidgetConfiguration`)

```typescript
interface WidgetConfiguration {
  mapConfigurationId: string;      // Building ID
  measurement: Datapoint;          // Primary measurement to display
  legend?: {
    title: string;
    thresholds?: Threshold[];      // Color-coding rules
  };
  datapointsPopup?: DatapointPopup[]; // Additional popup data
  buildingId: string;
  buildingName: string;
  columnConfig?: ColumnConfig[];   // Table column configuration
  markerStyle?: {
    useIcons?: boolean;           // Use device type icons
    defaultIcon?: string;         // Fallback icon
    iconSize?: [number, number];  // Icon dimensions
  };
}
```

### Measurement Thresholds

```typescript
type Threshold = {
  id: string;
  label: string;
  color: string;
} & (
  | { type: "measurement"; min: number; max: number }
  | { type: "event"; text: string; eventType?: string }
);
```

## Real-Time Data Integration

### Measurement Subscriptions

The plugin uses Cumulocity's real-time measurement service to automatically update device markers when new measurements arrive:

```typescript
// Primary measurement subscription for main display
primaryMeasurementReceivedSub?: Subscription;

// Additional measurements for popup details
measurementReceivedSub?: Subscription;
```

### Data Flow

1. **Initialization**: Plugin loads building configuration and subscribes to measurements
2. **Real-Time Updates**: New measurements trigger marker updates via reactive streams
3. **Threshold Evaluation**: Measurements are evaluated against configured thresholds
4. **Visual Updates**: Markers change color/state based on threshold rules

## Marker System

### Marker Types

1. **Standard Device Markers**: Based on device type with automatic icon detection
2. **Custom Styled Markers**: Using `c8y_marker` fragment configuration
3. **Measurement-Based Markers**: Color-coded based on current values

### Marker Configuration via `c8y_marker` Fragment

```json
{
  "c8y_marker": {
    "icon": "thermometer",
    "icon_color": "#FF6B35",
    "color": "#2E7D32",
    "size": 40,
    "label": "Custom Label",
    "popup": "<strong>Custom HTML</strong><br/>Zone: Production"
  }
}
```

### Dynamic Marker Updates

Markers automatically update based on:
- Real-time measurement values
- Threshold violations
- Device status changes
- Zone interactions

## Zone Management

### Zone Features

- **Creation**: Draw polygonal zones on floor plans
- **Device Assignment**: Automatic or manual device-to-zone mapping
- **Isolation**: Focus view on specific zones
- **Styling**: Custom colors and labels per zone

### Zone Data Structure

```typescript
interface Zone {
  id: string;
  name: string;
  color: string;
  coordinates: [number, number][];
  devices?: string[];
}
```

## Configuration UI Components

### 1. Map Configuration Modal
**Location**: `src/app/widget/config/map-config-modal/`

- Building selection and creation
- Floor plan upload and configuration
- Coordinate system setup
- Device assignment to floors

### 2. Device Location Assignment
**Location**: `src/app/widget/config/map-config-modal/assign-locations-modal/`

- Interactive device positioning
- Floor-by-floor device assignment
- Real-time position updates

### 3. Measurement Configuration
- Primary measurement selection
- Threshold configuration
- Legend setup
- Additional popup datapoints

### 4. Zone Configuration
**Location**: `src/app/widget/config/zones-creation/`

- Zone creation and editing
- Device-to-zone assignment
- Zone styling options

## API Integration

### Cumulocity Client Services Used

- **InventoryService**: Building and device management
- **InventoryBinaryService**: Floor plan image handling
- **MeasurementService**: Historical measurement data
- **MeasurementRealtimeService**: Real-time subscriptions
- **Realtime**: WebSocket connections for live updates

### Building Management API

```typescript
// Load building configuration
await buildingService.loadMapConfigurationWithImages(buildingId);

// Save building configuration
await inventoryService.update({
  id: buildingId,
  type: "c8y_Building",
  coordinates: mapCoordinates,
  levels: levelConfigurations
});
```

## Performance Considerations

### Optimization Strategies

1. **Lazy Loading**: Floor plan images loaded on-demand
2. **Measurement Throttling**: Rate-limited real-time updates
3. **Marker Clustering**: For high-density device deployments
4. **Zone Isolation**: Reduces rendering complexity for large buildings

### Memory Management

- Proper subscription cleanup in component lifecycle
- Blob URL management for images
- Leaflet map disposal on component destruction

## Security Considerations

### Data Privacy

- Building configurations stored as standard Cumulocity managed objects
- Device data follows existing Cumulocity security model
- Floor plan images stored in Cumulocity binary repository

### Access Control

- Widget respects Cumulocity user permissions
- Device visibility based on tenant access rights
- Building access can be restricted via standard inventory permissions

## Deployment

### Building the Plugin

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Deploy to Cumulocity
npm run deploy
```

### Plugin Registration

The plugin exports are defined in `package.json`:

```json
{
  "exports": [
    {
      "name": "Indoor Map Widget",
      "module": "DataPointIndoorMapModule", 
      "path": "./widget/data-point-indoor-map.module.ts",
      "description": "Interactive indoor map with IoT device visualization"
    }
  ]
}
```

## Development Setup

### Prerequisites

- Node.js 16+
- Angular 18+
- Cumulocity CLI tools
- Access to Cumulocity tenant

### Local Development

```bash
# Clone repository
git clone <repository-url>
cd cumulocity-indoor-map-plugin

# Install dependencies
npm install

# Start development server
npm start -- --shell cockpit
```

### Testing

The plugin can be tested in isolation or within the Cumulocity cockpit shell.

## Dependencies

### Core Dependencies

- **Angular 18**: Framework foundation
- **Leaflet**: Interactive map rendering
- **@geoman-io/leaflet-geoman-free**: Drawing tools for zones
- **@c8y/client**: Cumulocity platform integration
- **@c8y/ngx-components**: UI components and services

### Build Dependencies

- **@c8y/cli**: Build and deployment tools
- Standard Angular CLI toolchain

## Troubleshooting

### Common Issues

1. **Map not loading**: Check building configuration and image binary IDs
2. **Devices not appearing**: Verify device positioning and floor assignment
3. **Real-time not working**: Check measurement subscriptions and WebSocket connectivity
4. **Performance issues**: Consider zone isolation for large deployments

### Debug Mode

Enable detailed logging by setting localStorage flag:
```javascript
localStorage.setItem('c8y_indoor_map_debug', 'true');
```

## Future Enhancements

### Planned Features

- Heatmap visualization modes
- Advanced analytics overlays  
- 3D building visualization
- Integration with external floor plan systems
- Mobile-optimized responsive design
- Augmented reality positioning support