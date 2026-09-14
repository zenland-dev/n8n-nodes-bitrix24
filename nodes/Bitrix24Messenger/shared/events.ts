import type { IDataObject } from 'n8n-workflow';

import type { Bitrix24Context } from '../../../shared/transport';
import { bitrix24Request } from '../../../shared/transport';

/** The event types im.v2.Event.get delivers, as of 14.09.2026. */
export const MESSENGER_EVENTS = [
	{ name: 'Member Joined', value: 'ONIMV2JOINCHAT', description: 'Someone was added to a chat the webhook user is in' },
	{ name: 'Message Deleted', value: 'ONIMV2MESSAGEDELETE' },
	{ name: 'Message Edited', value: 'ONIMV2MESSAGEUPDATE', description: 'An edit made in Bitrix24. An edit made through the REST API (Message → Update) did not reach the queue on a live portal.' },
	{ name: 'New Message', value: 'ONIMV2MESSAGEADD', description: 'A message in any chat or private dialog of the webhook user, their own included' },
	{ name: 'Reaction Changed', value: 'ONIMV2REACTIONCHANGE' },
];

/** Most events one im.v2.Event.get call returns. */
export const EVENT_PAGE = 1000;

export interface EventPage {
	events: IDataObject[];
	nextOffset: number | undefined;
	hasMore: boolean;
}

/**
 * One call to the event queue of the webhook user. Passing `offset` confirms, and so
 * deletes, every event before it — for every reader of that user's queue, not just
 * this one.
 */
export async function readEvents(this: Bitrix24Context, offset: number | undefined, limit: number): Promise<EventPage> {
	const params: IDataObject = { limit };
	if (offset !== undefined) params.offset = offset;
	const body = await bitrix24Request.call(this, 'im.v2.Event.get', params);
	const result = (body.result ?? {}) as IDataObject;
	const next = Number(result.nextOffset);
	return {
		events: Array.isArray(result.events) ? (result.events as IDataObject[]) : [],
		nextOffset: Number.isFinite(next) && next > 0 ? next : undefined,
		hasMore: result.hasMore === true,
	};
}

/** An event as one flat item: its ID, type and date next to the data it carries. */
export function eventItem(event: IDataObject): IDataObject {
	const data = (event.data ?? {}) as IDataObject;
	return { eventId: event.eventId, type: event.type, date: event.date, ...data };
}
