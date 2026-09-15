import type { IDataObject } from 'n8n-workflow';

import type { Resource } from '../../../shared/spec';
import { optionalInt } from '../../../shared/values';
import { eventItem } from '../../Bitrix24Messenger/shared/events';
import { botIdProperty, readBotId } from '../shared/bot';
import { BOT_EVENT_PAGE, readBotEvents } from '../shared/events';

export const eventResource: Resource = {
	value: 'event',
	name: 'Event',
	description: 'The event queue of the bot: messages, commands, reactions, being added to chats',
	operations: [
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Read the events of a bot',
			description: 'Read queued events of a bot that keeps them for polling, oldest first. Passing an offset deletes the events before it for every reader of this bot.',
			properties: [
				botIdProperty,
				{
					displayName: 'Offset',
					name: 'offset',
					type: 'number',
					default: 0,
					description: 'The nextOffset of the previous read. It confirms, and so removes, every event before it. 0 reads from the oldest unconfirmed event and removes nothing.',
				},
				{ displayName: 'Limit', name: 'limit', type: 'number', typeOptions: { minValue: 1, maxValue: BOT_EVENT_PAGE }, default: 50, description: 'Max number of results to return' },
				{
					displayName: 'Include Webhook User Events',
					name: 'withUserEvents',
					type: 'boolean',
					default: false,
					description: 'Whether to add the messenger events of the webhook user (ONIMV2…) to the same read. Needs the im permission and Messenger → Event Queue → Subscribe first.',
				},
			],
			async execute(itemIndex) {
				const offset = optionalInt(this.getNodeParameter('offset', itemIndex, 0));
				const limit = Math.min(Math.max(Number(this.getNodeParameter('limit', itemIndex, 50)) || 50, 1), BOT_EVENT_PAGE);
				const withUserEvents = this.getNodeParameter('withUserEvents', itemIndex, false) === true;
				const page = await readBotEvents.call(this, readBotId(this, itemIndex), offset, limit, { withUserEvents, itemIndex });
				// The cursor rides on every event so the next read can take it from any item.
				return page.events.map((event): IDataObject => ({ ...eventItem(event), nextOffset: page.nextOffset ?? null, hasMore: page.hasMore }));
			},
		},
	],
};
