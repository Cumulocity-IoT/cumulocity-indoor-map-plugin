import { CommonModule } from "@angular/common";
import { Component, Input, OnInit, ViewEncapsulation } from "@angular/core";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import {
  AlarmService,
  EventService,
  IAlarm,
  IEvent,
  IManagedObject,
  InventoryService,
  IOperation,
  OperationService,
  TenantOptionsService,
  ITenantOption,
  IResultList,
} from "@c8y/client";
import { AlertService, CoreModule } from "@c8y/ngx-components";
import { BsModalRef } from "ngx-bootstrap/modal";

@Component({
  selector: "leaflet-popup-action-modal",
  templateUrl: "leaflet-popup-action-modal.component.html",
  standalone: true,
  imports: [CoreModule, CommonModule],
  encapsulation: ViewEncapsulation.None,
})
export class LeafletPopupActionModalComponent implements OnInit {
  @Input() device?: IManagedObject;
  @Input() actionType?: "alarm" | "event" | "operation";

  formGroup!: FormGroup;
  title: string = "Device Action";

  commandTemplates: IManagedObject[] = [];
  selectedCommandTemplate?: IManagedObject;

  availableEventTypes: string[] = [];
  availableAlarmTypes: string[] = [];

  private readonly ALARM_TYPES_KEY = "alarm_types";
  private readonly EVENT_TYPES_KEY = "event_types";
  private readonly TENANT_CATEGORY = "indoor-map";

  constructor(
    private modalRef: BsModalRef,
    private formBuilder: FormBuilder,
    private alarmService: AlarmService,
    private eventService: EventService,
    private operationService: OperationService,
    private alertService: AlertService,
    private inventoryService: InventoryService,
    private tenantOpService: TenantOptionsService
  ) {}

  async ngOnInit(): Promise<void> {
    this.setTitle();
    await this.loadInitialData();
    this.initForm();
  }

  private async loadInitialData(): Promise<void> {
    const promises: Promise<any>[] = [];

    promises.push(
      this.loadTenantOption(this.ALARM_TYPES_KEY).then(
        (types) => (this.availableAlarmTypes = types)
      )
    );
    promises.push(
      this.loadTenantOption(this.EVENT_TYPES_KEY).then(
        (types) => (this.availableEventTypes = types)
      )
    );

    if (this.actionType === "operation" && this.device?.id) {
      promises.push(this.loadCommandTemplates());
    }

    try {
      await Promise.all(promises);
    } catch (error) {
      console.warn("Failed to load some configuration data:", error);
    }
  }

  private async loadTenantOption(key: string): Promise<string[]> {
    try {
      const res: { data: ITenantOption } = await this.tenantOpService.detail({
        category: this.TENANT_CATEGORY,
        key: key,
      });
      return this.parseStringArray(res.data?.value ?? "[]");
    } catch (e) {
      return [];
    }
  }

  private async loadCommandTemplates(): Promise<void> {
    const deviceType = this.device?.["type"] ?? "";
    const filter = {
      type: "c8y_DeviceShellTemplate",
      deviceType: deviceType,
      pageSize: 100,
    };

    const res: IResultList<IManagedObject> = await this.inventoryService.list(
      filter
    );
    this.commandTemplates = res.data;
  }

  private parseStringArray(jsonString: string): string[] {
    if (!jsonString) {
      return [];
    }
    try {
      const parsedArray = JSON.parse(jsonString);
      if (
        Array.isArray(parsedArray) &&
        parsedArray.every((item) => typeof item === "string")
      ) {
        return parsedArray as string[];
      }
    } catch (error) {
      console.error("Error parsing JSON string:", error);
    }
    return [];
  }

  private initForm(): void {
    if (this.actionType === "alarm") {
      this.formGroup = this.createAlarmFormGroup();
    } else if (this.actionType === "event") {
      this.formGroup = this.createEventFormGroup();
    } else if (this.actionType === "operation") {
      this.formGroup = this.createOperationFormGroup();
    } else {
      this.formGroup = this.formBuilder.group({});
    }
  }

  private createAlarmFormGroup(): FormGroup {
    const defaultType = this.availableAlarmTypes[0] ?? "";
    return this.formBuilder.group({
      alarmType: [defaultType, Validators.required],
      severity: ["MAJOR", Validators.required],
      text: ["", Validators.required],
    });
  }

  private createEventFormGroup(): FormGroup {
    const defaultType = this.availableEventTypes[0] ?? "";
    return this.formBuilder.group({
      eventType: [defaultType, Validators.required],
      eventText: ["", Validators.required],
    });
  }

  private createOperationFormGroup(): FormGroup {
    return this.formBuilder.group({
      delayExecution: [false],
    });
  }

  setTitle(): void {
    const deviceName =
      this.device?.["name"] ?? this.device?.id ?? "Unknown Device";
    if (this.actionType === "alarm") {
      this.title = `Create Alarm for Device: ${deviceName}`;
    } else if (this.actionType === "event") {
      this.title = `Create Event for Device: ${deviceName}`;
    } else if (this.actionType === "operation") {
      this.title = `Send Operation for Device: ${deviceName}`;
    } else {
      this.title = `Action for Device: ${deviceName}`;
    }
  }

  onCancelButtonClicked(): void {
    this.hideDialog();
  }

  async onSaveButtonClicked(): Promise<void> {
    if (!this.formGroup.valid || !this.device?.id) {
      this.alertService.warning("Form is invalid or device is missing.");
      return;
    }

    if (this.actionType === "operation" && !this.selectedCommandTemplate) {
      this.alertService.warning("Please select a command template.");
      return;
    }

    const values = this.formGroup.value;

    try {
      if (this.actionType === "alarm") {
        const newAlarm = this.createAlarmPayload(values);
        await this.alarmService.create(newAlarm as IAlarm);
        this.alertService.success("Alarm created successfully");
      } else if (this.actionType === "event") {
        const newEvent = this.createEventPayload(values);
        await this.eventService.create(newEvent as IEvent);
        this.alertService.success("Event created successfully");
      } else if (this.actionType === "operation") {
        const newOperation = this.createOperationPayload(values);
        await this.operationService.create(newOperation as IOperation);
        this.alertService.success("Operation sent successfully");
      }
    } catch (error) {
      console.error("Error during API call:", error);
      this.alertService.danger(`Error processing ${this.actionType}: ${error}`);
    } finally {
      this.hideDialog();
    }
  }

  private createAlarmPayload(values: any): Partial<IAlarm> {
    return {
      source: { id: this.device?.id! },
      type: values.alarmType,
      text: values.text,
      severity: values.severity,
      status: "ACTIVE",
      time: new Date().toISOString(),
    };
  }

  private createEventPayload(values: any): Partial<IEvent> {
    return {
      source: { id: this.device?.id! },
      type: values.eventType,
      text: values.eventText || "Manual event created from map popup.",
      time: new Date().toISOString(),
    };
  }

  private createOperationPayload(values: any): Partial<IOperation> {
    const commandText = this.selectedCommandTemplate?.["command"] ?? "";

    const operation: Partial<IOperation> = {
      deviceId: this.device?.id!,
      text: `Operation: ${this.selectedCommandTemplate?.["name"]}`,
      c8y_Command: { text: commandText },
    };
    return operation;
  }

  private hideDialog() {
    this.modalRef.hide();
  }

  onTemplateSelected(template: IManagedObject): void {
    this.selectedCommandTemplate = template;
  }
}
