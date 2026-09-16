import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import type { Resource } from '../../shared/spec';
import { buildProperties, executeResources } from '../../shared/spec';
import { WEBHOOK_CREDENTIAL } from '../../shared/transport';
import { loadOptions } from './methods';
import { bookingResourceResource } from './resources/bookingResource';
import { calendarResource } from './resources/calendar';
import { eventResource } from './resources/event';
import { settingsResource } from './resources/settings';

const resources: Resource[] = [eventResource, calendarResource, bookingResourceResource, settingsResource];

export class Bitrix24Calendar implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitrix24 Calendar',
		name: 'bitrix24Calendar',
		icon: {
			light: 'file:../../icons/bitrix24.svg',
			dark: 'file:../../icons/bitrix24.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Create and read Bitrix24 calendar events, calendars and resource bookings',
		defaults: { name: 'Bitrix24 Calendar' },
		usableAsTool: true,
		builderHint: {
			searchHint:
				'Bitrix24 calendars as the user who owns the webhook. An event lives in a calendar of an owner: a user, a workgroup or the company, picked with Calendar Type and Owner ID; leave Owner ID at 0 for the webhook user. Event → Create takes a start and an end, an all-day switch, participants by user ID, reminders and a repeat rule; times are sent as local time of the workflow time zone unless Time Zone says otherwise. Event → Get Many reads a period of one owner, a month back to three months ahead by default, and returns everything in one answer. Get Availability shows when a list of people is busy, for finding a free slot. Booking Resource covers the rooms and equipment a CRM resource booking field offers. Every event the node creates belongs to the webhook user as organizer.',
			relatedNodes: [
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24Crm',
					relationHint: 'Reads the resource booking fields of leads and deals, and the records an event links to',
				},
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24Trigger',
					relationHint: 'Starts a workflow when a calendar event or a calendar is added, changed or deleted',
				},
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24',
					relationHint: 'Calls any Bitrix24 REST method this node lacks',
				},
			],
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: WEBHOOK_CREDENTIAL, required: true }],
		properties: buildProperties(resources, 'event'),
	};

	methods = { loadOptions };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await executeResources.call(this, resources);
	}
}
