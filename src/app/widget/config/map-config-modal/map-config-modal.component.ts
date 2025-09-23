import { IManagedObject, InventoryService, IResult } from "@c8y/client";
import { BsModalRef } from "ngx-bootstrap/modal";
import {
  MapConfiguration,
  MapConfigurationLevel,
} from "../../data-point-indoor-map.model";
import {
  AfterViewInit,
  Component,
  Input,
  OnDestroy,
  OnInit,
  ViewChild,
} from "@angular/core";
import { C8yStepper } from "@c8y/ngx-components";
import { Subject, takeUntil, throttleTime } from "rxjs";
import { CdkStep, STEPPER_GLOBAL_OPTIONS } from "@angular/cdk/stepper";

@Component({
  templateUrl: "./map-config-modal.component.html",
  styleUrls: ["./map-config-modal.component.less"],
  providers: [
    {
      provide: STEPPER_GLOBAL_OPTIONS,
      useValue: { showError: true, displayDefaultIndicatorType: false },
    },
  ],
})
export class MapConfigurationModalComponent
  implements OnInit, AfterViewInit, OnDestroy
{
  DEFAULT_LEVELS: MapConfigurationLevel[] = [
    {
      name: `Ground Floor`,
      markers: new Array<string>(),
      markerManagedObjects: new Array<IManagedObject>(),
      binaryId: undefined,
      imageDetails: {
        corners: [],
      },
    },
    {
      name: `Level 1`,
      markers: new Array<string>(),
      markerManagedObjects: new Array<IManagedObject>(),
      binaryId: undefined,
      imageDetails: {
        corners: [],
      },
    },
  ];
  isPending = false;
  isLoading = false;

  constructor(
    private bsModalRef: BsModalRef,
    private inventory: InventoryService
  ) {}

  STEPS = {
    NAME_STEP: 0,
    ASSIGN_LEVELS_STEP: 1,
    ASSIGN_LOCATIONS_STEP: 2,
  } as const;

  @Input() building: MapConfiguration = {
    type: "c8y_Building",
    name: "My new building",
    coordinates: {},
    //new Array<{ lat: number; lng: number }>(),
    location: "New Building",
    assetType: "Building",
    levels: this.DEFAULT_LEVELS,
  };
  selectedLevel?: MapConfigurationLevel;

  @ViewChild(C8yStepper, { static: false })
  stepper!: C8yStepper;
  private destroyNotifier$ = new Subject<void>();
  public onSave$: Subject<MapConfiguration> = new Subject<MapConfiguration>();

  async ngOnInit(): Promise<void> {
    if (this.building.id) {
      this.isLoading = true;
      for (const level of this.building.levels) {
        const markerPromises = level.markers.map((markerId) =>
          this.inventory.detail(markerId)
        );
        const markerMOs = await Promise.all(markerPromises);
        level.markerManagedObjects = markerMOs.map((r) => r.data);
      }
      this.isLoading = false;
    }
  }

  ngAfterViewInit() {
    this.stepper.selectionChange
      .pipe(throttleTime(100), takeUntil(this.destroyNotifier$))
      .subscribe((stepper: Partial<C8yStepper>) =>
        this.onStepperSelectionChange(stepper)
      );
  }

  ngOnDestroy() {
    this.destroyNotifier$.next();
    this.destroyNotifier$.complete();
  }

  onStepperSelectionChange(stepper: Partial<C8yStepper>) {
    console.log("Stepper selection change", stepper);
  }

  back() {
    this.stepper.previous();
  }

  next($event: { stepper: C8yStepper; step: CdkStep }) {
    const { step } = $event;
    step.completed = true;
    this.stepper.next();
  }

  cancel() {
    this.hideDialog();
  }

  async onComplete() {
    this.isPending = true;
    // upload marker coordinates
    const markerUpdates: Promise<IResult<IManagedObject>>[] = [];
    for (const level of this.building.levels) {
      for (const mo of level.markerManagedObjects ?? []) {
        if (mo.c8y_IndoorPosition) {
          markerUpdates.push(
            this.inventory.update({
              id: mo.id,
              c8y_IndoorPosition: mo.c8y_IndoorPosition,
            })
          );
        }
      }
    }
    await Promise.all(markerUpdates);
    // cleanup
    for (const level of this.building.levels) {
      delete level.blob;
      level.markers = level.markerManagedObjects?.map((mo) => mo.id) ?? [];
      delete level.markerManagedObjects;
    }
    // create/ update building
    if (this.building.id) {
      this.building = (await this.inventory.update(this.building))
        .data as unknown as MapConfiguration;
    } else {
      this.building = (await this.inventory.create(this.building))
        .data as unknown as MapConfiguration;
    }
    this.isPending = false;
    this.onSave$.next(this.building);
    this.onSave$.complete();
    this.hideDialog();
  }

  private hideDialog(): void {
    this.bsModalRef.hide();
  }
}
