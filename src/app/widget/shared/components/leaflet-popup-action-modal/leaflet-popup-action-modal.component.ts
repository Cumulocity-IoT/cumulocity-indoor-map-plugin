import { CommonModule } from "@angular/common";
import { Component, Input, OnInit, ViewEncapsulation } from "@angular/core";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import {
  AlarmService,
  EventService,
  IAlarm,
  IEvent,
  IOperation,
  OperationService,
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
  @Input() deviceId?: string;
  @Input() actionType?: "alarm" | "event" | "operation";

  formGroup?: FormGroup;
  title: string = "Device Action";

  constructor(
    private modalRef: BsModalRef,
    private formBuilder: FormBuilder,
    private alarmService: AlarmService,
    private eventService: EventService,
    private operationService: OperationService,
    private alertService: AlertService
  ) {}

  ngOnInit() {
    this.initForm();
    this.setTitle();
  }

  private setTitle(): void {
    if (this.actionType === "alarm") {
      this.title = `Create Alarm for Device ID: ${this.deviceId}`;
    } else if (this.actionType === "event") {
      this.title = `Create Event for Device ID: ${this.deviceId}`;
    } else if (this.actionType === "operation") {
      this.title = `Send Operation for Device ID: ${this.deviceId}`;
    } else {
      this.title = `Action for Device ID: ${this.deviceId}`;
    }
  }

  onCancelButtonClicked(): void {
    this.hideDialog();
  }

  private initForm(): void {
    if (this.actionType === "alarm") {
      this.formGroup = this.acceptAlarmFormGroup();
    } else if (this.actionType === "event") {
      this.formGroup = this.acceptEventFormGroup();
    } else if (this.actionType === "operation") {
      this.formGroup = this.sendOperationFormGroup();
    } else {
      // Default or fallback form (using the original structure)
      this.formGroup = this.formBuilder.group({});
    }
  }

  private acceptAlarmFormGroup(): FormGroup {
    return this.formBuilder.group({
      alarmType: ["", Validators.required],
      severity: ["MAJOR", Validators.required],
      text: ["", Validators.required],
    });
  }

  private acceptEventFormGroup(): FormGroup {
    return this.formBuilder.group({
      eventType: ["", Validators.required],
      eventText: ["", Validators.required],
    });
  }

  private sendOperationFormGroup(): FormGroup {
    return this.formBuilder.group({
      c8y_Command: ["", Validators.required],
      commandValue: ["", Validators.required],
      delayExecution: [false],
    });
  }

  onSaveButtonClicked(): void {
    if (this.formGroup?.valid && this.deviceId) {
      const values = this.formGroup.value;

      if (this.actionType === "alarm") {
        const newAlarm = this.createAlarmPayload(values);
        this.alarmService
          .create(newAlarm as IAlarm)
          .then(() => {
            this.alertService.success("Alarm created successfully");
          })
          .catch((error) => {
            this.alertService.danger("Error creating alarm:", error);
          });
      } else if (this.actionType === "event") {
        const newEvent = this.createEventPayload(values);
        this.eventService
          .create(newEvent as IEvent)
          .then(() => {
            this.alertService.success("Event created successfully");
          })
          .catch((error) => {
            this.alertService.danger("Error creating event:", error);
          });
      } else if (this.actionType === "operation") {
        const newOperation = this.createOperationPayload(values);
        this.operationService
          .create(newOperation as IOperation)
          .then(() => {
            this.alertService.success("Operation sent successfully");
          })
          .catch((error) => {
            this.alertService.danger("Error sending operation:", error);
          });
      }

      this.hideDialog();
    }
  }

  private createAlarmPayload(values: any): Partial<IAlarm> {
    return {
      source: { id: this.deviceId! },
      type: values.alarmType,
      text: values.text,
      severity: values.severity,
      status: "ACTIVE",
      time: new Date().toISOString(),
    };
  }

  private createEventPayload(values: any): Partial<IEvent> {
    return {
      source: { id: this.deviceId! },
      type: values.eventType,
      text: values.eventText || "Manual event created from map popup.",
      time: new Date().toISOString(),
    };
  }

  private createOperationPayload(values: any): Partial<IOperation> {
    // The operation payload uses the form group keys directly to form the fragment
    const operationFragment: any = {};
    operationFragment[values.c8y_Command] = values.commandValue;

    return {
      deviceId: this.deviceId!,
      // Status is PENDING by default when created
      // The delayExecution logic would require more advanced scheduling,
      // but for basic API call, we just send it.
      ...operationFragment,
    };
  }
  private hideDialog() {
    this.modalRef.hide();
  }
}
