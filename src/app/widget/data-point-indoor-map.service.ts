/**
 * Copyright (c) 2022 Software AG, Darmstadt, Germany and/or its licensors
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { Injectable } from "@angular/core";
import {
  IManagedObject,
  IMeasurement,
  InventoryBinaryService,
  InventoryService,
  MeasurementService,
  Realtime,
} from "@c8y/client";
import {
  Datapoint,
  isMapConfigutaration,
  MapConfiguration,
  MapConfigurationLevel,
  Measurement,
} from "./data-point-indoor-map.model";
import { has, get } from "lodash";
import { filter, Subject, Subscription } from "rxjs";
import { MeasurementRealtimeService } from "@c8y/ngx-components";

@Injectable()
export class DataPointIndoorMapService {
  public primaryMeasurementReceived$: Subject<{
    deviceId: string;
    measurement: Measurement;
  }> = new Subject<{ deviceId: string; measurement: Measurement }>();

  public measurementReceived$: Subject<{
    deviceId: string;
    measurement: Measurement;
  }> = new Subject<{ deviceId: string; measurement: Measurement }>();
  subscriptions: Subscription[] = [];

  constructor(
    private inventoryService: InventoryService,
    private binaryService: InventoryBinaryService,
    private measurementService: MeasurementService,
    private measurementRealtime: MeasurementRealtimeService
  ) {}

  /*   async loadMapConfigurationWithImages(
    mapConfigurationId: string
  ): Promise<MapConfiguration> {
    if (!mapConfigurationId) {
      throw new Error("Missing map configuration id!");
    }

    const { data: mapConfiguration } = await this.inventoryService.detail(
      mapConfigurationId
    );
    if (!isMapConfigutaration(mapConfiguration)) {
      throw new Error("Invalid map configuration!");
    }

    if (mapConfiguration.levels && mapConfiguration.levels.length === 0) {
      return mapConfiguration;
    }

    const promises: Promise<Blob>[] = [];
    mapConfiguration.levels
      .filter((l) => l.binaryId)
      .forEach((level) => promises.push(this.loadImage(level.binaryId!)));

    const imageBlobs = await Promise.all(promises);

    const dimensionPromises = mapConfiguration.levels.map((level, index) => {
      level.blob = imageBlobs[index];
      return this.readImage(level.blob).then(({ width, height }) => {
        level.imageDetails.dimensions = { width, height };
      });
    });
    await Promise.all(dimensionPromises);

    return mapConfiguration;
  } */
  async loadMapConfigurationWithImages(
    mapConfigurationId: string
  ): Promise<MapConfiguration> {
    if (!mapConfigurationId) {
      throw new Error("Missing map configuration id!");
    }

    const { data: mapConfiguration } = await this.inventoryService.detail(
      mapConfigurationId
    );
    if (!isMapConfigutaration(mapConfiguration)) {
      throw new Error("Invalid map configuration!");
    }

    if (mapConfiguration.levels && mapConfiguration.levels.length === 0) {
      return mapConfiguration;
    }

    // only consider levels that actually have a binaryId
    const levelsWithBinary = mapConfiguration.levels.filter((l) => l.binaryId);
    const imageBlobs = await Promise.all(
      levelsWithBinary.map((level) => this.loadImage(level.binaryId!))
    );

    const dimensionPromises = levelsWithBinary.map((level, index) => {
      level.blob = imageBlobs[index];
      return this.readImage(level.blob!).then(({ width, height }) => {
        level.imageDetails.dimensions = { width, height };
      });
    });
    await Promise.all(dimensionPromises);

    return mapConfiguration;
  }

  /*  private async readImage(blob: Blob) {
    const bmp = await createImageBitmap(blob);
    const { width, height } = bmp;
    bmp.close(); // free memory
    return {  width, height };
  }
 */
  private async readImage(blob: Blob) {
    try {
      // preferred modern API
      const bmp = await createImageBitmap(blob);
      const { width, height } = bmp;
      bmp.close(); // free memory
      return { width, height };
    } catch (e) {
      // fallback for environments where createImageBitmap fails
      const url = URL.createObjectURL(blob);
      try {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("Failed to load image"));
          img.src = url;
        });
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        return { width, height };
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }

  async loadMarkersForLevels(
    levels: MapConfigurationLevel[]
  ): Promise<IManagedObject[][]> {
    if (!levels || levels.length === 0) {
      return [];
    }

    const promises: Promise<IManagedObject[]>[] = [];
    levels.forEach((level) => promises.push(this.loadMarkers(level.markers)));

    return Promise.all(promises);
  }

  async loadMarkers(markerIds: string[]): Promise<IManagedObject[]> {
    if (!markerIds || markerIds.length === 0) {
      return [];
    }

    const query = {
      __filter: {
        __or: new Array<object>(),
      },
    };

    markerIds.forEach((markerId) =>
      query.__filter.__or.push({ __eq: { id: markerId } })
    );
    const response = await this.inventoryService.listQuery(query, {
      pageSize: 2000,
    });
    return response.data;
  }

  async loadImage(imageId: string): Promise<Blob> {
    /* const imageBlob = await (
      (await this.binaryService.download(imageId)) as Response
    ).blob();
    return imageBlob; */

    const downloaded: any = await this.binaryService.download(imageId);

    // If the service already returned a Response (fetch-like)
    if (
      downloaded &&
      typeof downloaded === "object" &&
      typeof downloaded.blob === "function"
    ) {
      return (await downloaded.blob()) as Blob;
    }

    // If it's already a Blob
    if (downloaded instanceof Blob) {
      return downloaded;
    }

    // If it's an ArrayBuffer
    if (downloaded instanceof ArrayBuffer) {
      return new Blob([downloaded]);
    }

    // If it's a typed array / view
    /* if (ArrayBuffer.isView(downloaded)) {
      return new Blob([downloaded.buffer]);
    } */

    // If it's a base64 string (possibly a data URI)
    if (typeof downloaded === "string") {
      const base64 = downloaded.startsWith("data:")
        ? downloaded.split(",")[1]
        : downloaded;
      const binary = atob(base64);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new Blob([bytes]);
    }

    throw new Error(
      "Unsupported binary type returned from binaryService.download"
    );
  }

  public async loadLatestMeasurements(
    deviceIds: string[],
    measurementFragment: string,
    measurementSeries: string
  ): Promise<Array<Measurement | undefined>> {
    if (!deviceIds || deviceIds.length === 0) {
      return [];
    }

    const promises = deviceIds.map((deviceId) =>
      this.loadLatestMeasurement(
        deviceId,
        measurementFragment,
        measurementSeries
      )
    );

    return Promise.all(promises).then((measurements) => {
      return measurements.filter((m) => !!m);
    });
  }

  public async loadLatestMeasurement(
    deviceId: string,
    measurementFragment: string,
    measurementSeries: string
  ): Promise<Measurement | undefined> {
    const filter = {
      source: deviceId,
      dateFrom: "1970-01-01",
      dateTo: new Date().toISOString(),
      valueFragmentType: measurementFragment,
      valueFragmentSeries: measurementSeries,
      pageSize: 1,
      revert: true,
    };

    return this.measurementService.list(filter).then((response) => {
      if (
        !response.data ||
        response.data.length != 1 ||
        !has(response.data[0], `${measurementFragment}.${measurementSeries}`)
      ) {
        return undefined;
      }

      const measurementValue: number = get(
        response.data[0],
        `${measurementFragment}.${measurementSeries}.value`
      );
      const measurementUnit: string = get(
        response.data[0],
        `${measurementFragment}.${measurementSeries}.unit`
      );

      return {
        value: measurementValue,
        unit: measurementUnit,
        datapoint: {
          fragment: measurementFragment,
          series: measurementSeries,
        },
      };
    });
  }

  public subscribeForMeasurements(
    deviceIds: string[],
    primaryDatapoint: Datapoint,
    datapoints: Datapoint[]
  ) {
    if (!deviceIds || deviceIds.length === 0) {
      return;
    }

    this.subscriptions = deviceIds.map((deviceId) =>
      this.subscribeForMeasurement(deviceId, primaryDatapoint, datapoints)
    );
  }

  public unsubscribeAllMeasurements() {
    this.subscriptions.forEach((s) => {
      s.unsubscribe();
    });
    this.subscriptions = [];
  }

  private subscribeForMeasurement(
    deviceId: string,
    primaryDatapoint: Datapoint,
    datapoints: Datapoint[]
  ) {
    return this.measurementRealtime
      .onCreate$(deviceId)
      .pipe(
        filter((m) => {
          return this.hasAnyDatapoint(m, [primaryDatapoint, ...datapoints]);
        })
      )
      .subscribe((m) => {
        if (this.hasDatapoint(m, primaryDatapoint)) {
          const measurementReceived: Measurement = {
            value: get(
              m,
              `${primaryDatapoint.fragment}.${primaryDatapoint.series}.value`
            ),
            unit: get(
              m,
              `${primaryDatapoint.fragment}.${primaryDatapoint.series}.unit`
            ),
            datapoint: {
              fragment: primaryDatapoint.fragment,
              series: primaryDatapoint.series,
            },
          };
          this.primaryMeasurementReceived$.next({
            deviceId,
            measurement: measurementReceived,
          });
        }

        datapoints.forEach((dp) => {
          if (this.hasDatapoint(m, dp)) {
            const measurementReceived: Measurement = {
              value: get(m, `${dp.fragment}.${dp.series}.value`),
              unit: get(m, `${dp.fragment}.${dp.series}.unit`),
              datapoint: dp,
            };
            this.measurementReceived$.next({
              deviceId,
              measurement: measurementReceived,
            });
          }
        });
      });
  }

  private hasAnyDatapoint(m: IMeasurement, dps: Datapoint[]) {
    for (const dp of dps) {
      if (this.hasDatapoint(m, dp)) {
        return true;
      }
    }
    return false;
  }

  private hasDatapoint(m: IMeasurement, datapoint: Datapoint) {
    return has(m, `${datapoint.fragment}.${datapoint.series}`);
  }
}
