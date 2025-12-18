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
import { Component, Input, OnInit } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { DatapointPopup } from '../../../models/data-point-indoor-map.model';
import { BsModalRef } from 'ngx-bootstrap/modal';
import { Subject } from 'rxjs';

@Component({
  selector: 'managed-datapoints-popup-modal-dialog',
  templateUrl: 'managed-datapoints-popup-modal.component.html'
})
export class ManagedDatapointsPopupModalComponent implements OnInit {
  @Input() supportedDatapoints?: string[];

  @Input() datapointsPopup: DatapointPopup[] = [];

  public onSave$: Subject<DatapointPopup[]> = new Subject<DatapointPopup[]>();

  formGroup!: FormGroup;

  constructor(private modalRef: BsModalRef, private formBuilder: FormBuilder) {}

  ngOnInit() {
    this.initForm();
  }

  onCancelButtonClicked(): void {
    this.hideDialog();
  }

  onSaveButtonClicked(): void {
    this.onSave$.next(this.createDatapoints());
    this.hideDialog();
  }

  private initForm(): void {
    this.formGroup = this.formBuilder.group({
      datapoints: this.createDatapointFormArray()
    });
  }

  private createDatapointFormArray(): FormArray {
    const formArray: FormArray = this.formBuilder.array([]);

    if (!this.supportedDatapoints || this.supportedDatapoints.length === 0) {
      return formArray;
    }

    this.supportedDatapoints.forEach(datapoint => {
      const configuredDatapoint = this.datapointsPopup.find(
        datapointPopup =>
          `${datapointPopup.measurement.fragment}.${datapointPopup.measurement.series}` ===
          datapoint
      );
      formArray.push(
        configuredDatapoint
          ? this.createDatapointFormGroup(datapoint, configuredDatapoint.label, true)
          : this.createDatapointFormGroup(datapoint, datapoint, false)
      );
    });
    return formArray;
  }

  private createDatapointFormGroup(
    datapoint: string,
    datapointLabel: string,
    isEnabled: boolean
  ): FormGroup {
    return this.formBuilder.group({
      isEnabled: [isEnabled, Validators.required],
      label: [datapointLabel, Validators.required],
      structure: [datapoint]
    });
  }

  private createDatapoints(): DatapointPopup[] {
    const datapoints: DatapointPopup[] = [];

    (this.formGroup!.value.datapoints as Array<{
      isEnabled: boolean;
      label: string;
      structure: string;
    }>).forEach(datapoint => {
      if (!datapoint.isEnabled) {
        return;
      }

      const measurementStructure: string[] = datapoint.structure.split('.');
      datapoints.push({
        measurement: {
          fragment: measurementStructure[0],
          series: measurementStructure[1]
        },
        label: datapoint.label
      });
    });

    return datapoints;
  }

  private hideDialog() {
    this.modalRef.hide();
  }
}
