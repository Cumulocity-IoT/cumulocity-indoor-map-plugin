# Cumulocity Indoor Map Plugin - User Guide

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [Creating Your First Indoor Map](#creating-your-first-indoor-map)
4. [Widget Configuration](#widget-configuration)
5. [Device Management](#device-management)
6. [Zone Management](#zone-management)
8. [Advanced Features](#advanced-features)
9. [Troubleshooting](#troubleshooting)

## Introduction

The Cumulocity Indoor Map Plugin transforms how you visualize and monitor your IoT devices within buildings. Whether you're managing sensors in an office building, monitoring equipment in a factory, or tracking assets in a warehouse, this plugin provides an intuitive visual interface overlaid on your actual floor plans.

### What You Can Do

✅ **Visualize Device Locations**: See exactly where your IoT devices are positioned on real floor plans  
✅ **Create Custom Zones**: Define areas for grouping and analysis   
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

3. **Configure building coordinates** (for precise mapping):
   - **Latitude/Longitude**: Set GPS coordinates of the building via map 
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
     - Clear, high-contrast images work best

#### Device Assignment
- Assign or unassign one or multiple devices to a selected floor plan 

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


#### Drawing Zones

1. **Enable zone creation mode**:
   - Click the **"Create Zone"** button
   - Select **drawing tools** from the toolbar

2. **Draw zone boundaries**:
   - Click to create polygon vertices
   - Double-click to complete the zone
   - Use the **rectangle tool** for simple rectangular zones

### Device Search and Filtering

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

