export interface Coordinates {
  /**
   * Defines how the map is placed (e.g., 'corners' or 'polygon' if using c8y-gps-component).
   */
  placementMode?: 'corners' | 'polygon' | string;

  /**
   * Latitude of the Top-Left corner of the map image.
   */
  topLeftLat?: number;

  /**
   * Longitude of the Top-Left corner of the map image.
   */
  topLeftLng?: number;

  /**
   * Latitude of the Bottom-Right corner of the map image.
   */
  bottomRightLat?: number;

  /**
   * Longitude of the Bottom-Right corner of the map image.
   */
  bottomRightLng?: number;

  // The c8y-gps-component may also output other properties if placementMode is 'polygon', such as:
  // polygonVerticesJson?: string;
  // anchorLat?: number;
  // anchorLng?: number;
  // scaleX?: number;
  // scaleY?: number;
}