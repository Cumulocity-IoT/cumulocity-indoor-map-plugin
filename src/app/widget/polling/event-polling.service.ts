import { Injectable } from '@angular/core';
import { EventService, IEvent, IManagedObject } from '@c8y/client';
import { groupBy } from 'lodash';
import { Observable } from 'rxjs';
import { Threshold } from '../../models/data-point-indoor-map.model';

const FETCH_INTERVAL = 10_000;

@Injectable()
export class EventPollingService {
  intervalId?: NodeJS.Timeout;
  isRunning = false;
  constructor(private eventService: EventService) {}

  startPolling(ids: IManagedObject['id'][], thresholds: Threshold[]): Observable<{ deviceId: IManagedObject['id']; event: IEvent }> {
    return new Observable((observer) => {
      if (!this.isRunning) {
        this.runTask(ids, thresholds)
          .then((res) => {
            res.forEach((tuple) => {
              observer.next(tuple);
            });
          })
          .catch((err) => {
            observer.error(err);
          });
      }

      const intervalId = setInterval(() => {
        if (!this.isRunning) {
          this.runTask(ids, thresholds)
            .then((res) => {
              res.forEach((tuple) => {
                observer.next(tuple);
              });
            })
            .catch((err) => {
              observer.error(err);
            });
        } else {
          console.log('Task skipped because previous execution is still running');
        }
      }, FETCH_INTERVAL);

      return () => {
        console.log('Task is stopping...');
        clearInterval(intervalId);
        this.isRunning = false;
      };
    });
  }

  private async runTask(ids: IManagedObject['id'][], thresholds: Threshold[]): Promise<{ deviceId: string; event: IEvent }[]> {
    this.isRunning = true;

    try {
      const requests = ids.map((id) => this.fetchLatestEventsForThresholds(id, thresholds).then((res) => ({ deviceId: id, event: res })));
      const responses = await Promise.all(requests);
      return responses.filter((tuple) => tuple.event !== undefined) as { deviceId: string; event: IEvent }[];
    } catch (error) {
      console.error('Task failed:', error);
      return [];
    } finally {
      this.isRunning = false; // Mark task as completed
    }
  }

  async fetchLatestEventsForThresholds(moId: IManagedObject['id'], thresholds: Threshold[]) {
    const eventThresholds = thresholds.filter((t) => t.type === 'event');
    const groupsDict = groupBy(eventThresholds, 'eventType');
    const promises = Object.keys(groupsDict).map((type) => {
      const filter = {
        pageSize: 1,
        withTotalPages: false,
        source: moId,
        type,
      };
      return this.eventService.list(filter).then((res) => res.data);
    });

    const events = await Promise.all(promises);

    const flattened = events.flat();
    if (flattened.length === 0) {
      return undefined;
    } else {
      const eventsMatchingThresholds = flattened.filter((event) => {
        const thresholdsByType = groupsDict[event.type];
        const isEventMatchingAnyThreshold = thresholdsByType.some((threshold) => threshold.text === event.text);
        return isEventMatchingAnyThreshold;
      });
      if (eventsMatchingThresholds.length === 0) {
        return undefined;
      }

      // reduce the array to the event with the latest creationTime
      const latestEvent = eventsMatchingThresholds.reduce((latest, current) => {
        return new Date(`${current.creationTime}`) > new Date(`${latest.creationTime}`) ? current : latest;
      });
      return latestEvent;
    }
  }
}
