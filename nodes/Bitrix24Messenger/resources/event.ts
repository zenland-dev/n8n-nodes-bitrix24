import type { IDataObject } from 'n8n-workflow';

import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { optionalInt } from '../../../shared/values';
import { EVENT_PAGE, eventItem, readEvents } from '../shared/events';

export const eventQueueResource: Resource = {
	value: 'eventQueue',
	name: 'Event Queue',
	description: 'The queue of messenger events of the webhook user, read without a public URL',
	operations: [
		{
			value: 'subscribe',
			name: 'Subscribe',
			action: 'Start recording messenger events',
			description: 'Start recording messages, edits, deletions, reactions and new members in the chats of the webhook user. Safe to repeat.',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'im.v2.Event.subscribe', {}, { itemIndex });
				return { subscribed: body.result === true };
			},
		},
		{
			value: 'unsubscribe',
			name: 'Unsubscribe',
			action: 'Stop recording messenger events',
			description: 'Stop recording events for the webhook user; events already recorded stay readable for 24 hours',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'im.v2.Event.unsubscribe', {}, { itemIndex });
				return { unsubscribed: body.result === true };
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Read recorded messenger events',
			description: 'Read recorded events, oldest first. Passing an offset deletes the events before it for every reader of this user\'s queue.',
			properties: [
				{
					displayName: 'Offset',
					name: 'offset',
					type: 'number',
					default: 0,
					description: 'The nextOffset of the previous read. It confirms, and so removes, every event before it. 0 reads from the oldest event and removes nothing.',
				},
				{ displayName: 'Limit', name: 'limit', type: 'number', typeOptions: { minValue: 1, maxValue: EVENT_PAGE }, default: 50, description: 'Max number of results to return' },
			],
			async execute(itemIndex) {
				const offset = optionalInt(this.getNodeParameter('offset', itemIndex, 0));
				const limit = Math.min(Math.max(Number(this.getNodeParameter('limit', itemIndex, 50)) || 50, 1), EVENT_PAGE);
				const page = await readEvents.call(this, offset, limit);
				// The cursor rides on every event so the next read can take it from any item.
				return page.events.map((event): IDataObject => ({ ...eventItem(event), nextOffset: page.nextOffset ?? null, hasMore: page.hasMore }));
			},
		},
	],
};
