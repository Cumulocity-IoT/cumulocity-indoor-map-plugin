# Cumulocity Indoor Map Plugin

A comprehensive Angular-based widget for visualizing IoT devices and their real-time data on interactive indoor floor plans within the Cumulocity IoT platform.

![Indoor Map Widget](https://img.shields.io/badge/Cumulocity-Indoor%20Map-blue) ![Angular](https://img.shields.io/badge/Angular-18-red) ![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue) ![Leaflet](https://img.shields.io/badge/Leaflet-1.9-green)

## 🌟 Features

- **📍 Interactive Floor Plans**: Overlay IoT devices on real building floor plans
- **🏢 Multi-Level Buildings**: Navigate between floors seamlessly
- **🎯 Zone Management**: Create, edit, and manage functional areas
- **🔍 Advanced Search & Filtering**: Find devices by name, type, or properties
- **🎨 Customizable Markers**: Device-specific icons, colors, and labels

## 📚 Documentation

### 📖 [User Guide](./docs/USER_GUIDE.md)
Complete guide for end-users covering setup, configuration, and daily usage.

### 🔧 [Technical Documentation](./docs/TECHNICAL_DOCUMENTATION.md)  
Comprehensive technical documentation for developers and administrators.

### ⚙️ [Marker Configuration Guide](./docs/MARKER_CONFIGURATION.md)
Detailed guide for customizing device marker appearance and behavior.

## 🚀 Quick Start

### Prerequisites

- Cumulocity IoT tenant access
- Node.js 16+ and npm
- Angular CLI
- Cumulocity CLI tools

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd cumulocity-indoor-map-plugin
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure your tenant**
   ```bash
   # Update cumulocity.config.ts with your tenant URL
   # or use CLI authentication
   ```

4. **Start development server**
   ```bash
   npm start -- --shell cockpit
   ```

5. **Build and deploy**
   ```bash
   npm run build
   npm run deploy
   ```

## 🏗️ Plugin Architecture

This plugin is built using Cumulocity's module federation architecture:

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

### Core Components

- **DataPointIndoorMapComponent**: Main widget component
- **BuildingService**: Building configuration and data management
- **ImageRotateService**: Floor plan image manipulation
- **Configuration Modals**: Setup and customization interfaces

## 🔧 Configuration

### Basic Setup

1. Add the widget to your dashboard
2. Create or select a building configuration
3. Upload floor plan images
4. Position your IoT devices on the map
5. Configure measurements and thresholds

### Advanced Features

- **Zone Creation**: Define functional areas on floor plans
- **Custom Markers**: Use `c8y_marker` fragment for device customization
- **Threshold Management**: Set up color-coded alerts based on sensor values
- **Multi-Floor Navigation**: Support for complex building layouts


## 🤝 Contributing

Contributions are welcome! Please read the technical documentation for development guidelines.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

### 📋 Getting Help

Need assistance? We've got you covered! Choose the best support channel for your needs:

#### 🔍 Self-Service Resources
- 📖 **[User Guide](./docs/USER_GUIDE.md)** - Step-by-step setup and usage instructions
- 🔧 **[Technical Documentation](./docs/TECHNICAL_DOCUMENTATION.md)** - Development and integration guides
- ⚙️ **[Marker Configuration](./docs/MARKER_CONFIGURATION.md)** - Customize device markers and styling

#### 🐛 Issues & Bugs
- **GitHub Issues** - Report bugs, request features, or ask technical questions
- **Widget Resize Problems** - If the map doesn't render correctly after resizing, check that you're using the latest version (v1.0.3+)

#### 💬 Community Support
- **[Cumulocity Community Forum](https://community.cumulocity.com/)** - Connect with other developers, share use cases, and get expert advice
- **Discussion Topics**: Best practices, implementation tips, integration patterns

#### ⚡ Quick Troubleshooting
- **Map not loading?** Verify building configuration and image uploads
- **Devices not showing?** Check device positioning and measurement configurations  
- **Performance issues?** Review the technical documentation for optimization tips

## 🔄 Version History

- **v1.0.3**: Current stable release
  - Multi-level building support
  - Enhanced zone management
  - Improved real-time performance
  - Mobile responsiveness

## 🙏 Acknowledgments

- Built on Cumulocity IoT platform
- Uses Leaflet for interactive mapping
- Leverages Angular and TypeScript
- Icons provided by Cumulocity design system
