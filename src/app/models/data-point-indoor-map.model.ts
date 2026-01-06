import { IManagedObject } from "@c8y/client";

export interface WidgetConfiguration {
  mapConfigurationId: string;
  measurement: Datapoint;
  legend?: {
    title: string;
    thresholds?: Threshold[];
  };
  datapointsPopup?: DatapointPopup[];
  buildingId: string;
  buildingName: string;
  columnConfig?: ColumnConfig[];
  markerStyle?: {
    useIcons?: boolean;
    defaultIcon?: string;
    iconSize?: [number, number];
  };
}

export type Threshold = {
  id: string;
  label: string;
  color: string;
} & (
  | { type: "measurement"; min: number; max: number }
  | { type: "event"; text: string; eventType?: string }
);

export interface DatapointPopup {
  measurement: Datapoint;
  label: string;
}

export interface Datapoint {
  fragment: string;
  series: string;
}

export interface ColumnConfig {
  key: string;
  label: string;
  enabled: boolean;
  order: number;
}

export interface Measurement {
  value: number;
  unit?: string;
  datapoint: Datapoint;
}

export interface MapConfiguration {
  id?: string;
  name: string;
  coordinates: GPSCoordinates;
  location: string;
  assetType: string;
  levels: MapConfigurationLevel[];
  allZonesByLevel?: { [levelName: string]: ZoneGeometry[] };
  type: "c8y_Building";
}

export interface GPSCoordinates {
  topLeftLat?: number;
  topLeftLng?: number;
  bottomRightLat?: number;
  bottomRightLng?: number;
  polygonVerticesJson?: string;
  placementMode?: string;
  rotationAngle?: number;
  zoomLevel?: number;
}

export function isMapConfigutaration(obj: any): obj is MapConfiguration {
  return obj.levels && obj.type === "c8y_Building";
}

export interface MapConfigurationLevel {
  [x: string]: any;
  name: string;
  /** binary id of the image */
  binaryId?: string;
  /** downloaded image stored as Blob */
  blob?: Blob;
  /** markers ids which reference the corresponding managed object */
  markers: { id: string; name: string }[];

  imageDetails: {
    dimensions?: { width: number; height: number };
  };
}

export interface MarkerManagedObject extends IManagedObject {
  c8y_Position?: {
    lat: number;
    lng: number;
  };
  c8y_marker?: DeviceMarker;
}

export interface DeviceMarker {
  color?: string;
  size?: string;
  icon?: string;
  icon_color?: string;
  icon_size?: number;
  popup?: string;
  label?: string;
}

export interface ZoneGeometry {
  type: string;
  coordinates: L.LatLng[][];
  rotation?: number; // Keep rotation for each zone if available
  bounds: { tl: L.LatLng; br: L.LatLng }; // Simplified bounds for re-centering
}
