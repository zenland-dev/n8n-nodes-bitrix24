import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { compact, jsonParameter } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { yn } from '../../../shared/values';

const userSettingsProperty: INodeProperties = {
	displayName: 'Settings',
	name: 'settings',
	type: 'collection',
	placeholder: 'Add Setting',
	default: {},
	description: 'The settings to change. What you leave out stays as it is.',
	options: [
		{
			displayName: 'CRM Calendar ID',
			name: 'crmSection',
			type: 'string',
			default: '',
			description: 'Calendar that holds the events CRM creates',
		},
		{
			displayName: 'Default Calendar ID',
			name: 'lastUsedSection',
			type: 'string',
			default: '',
			description: 'Calendar new events go into when none is named',
		},
		{
			displayName: 'Default View',
			name: 'view',
			type: 'options',
			default: 'week',
			options: [
				{ name: 'Day', value: 'day' },
				{ name: 'List', value: 'list' },
				{ name: 'Month', value: 'month' },
				{ name: 'Week', value: 'week' },
			],
			description: 'The view the calendar opens in',
		},
		{
			displayName: 'Hide Non-Working Hours',
			name: 'collapseOffHours',
			type: 'boolean',
			default: false,
			description: 'Whether the day and week views fold away the hours outside the working day',
		},
		{
			displayName: 'Invitations Calendar ID',
			name: 'meetSection',
			type: 'string',
			default: '',
			description: 'Calendar that holds the events the user is invited to',
		},
		{
			displayName: 'Refuse Invitations When Busy',
			name: 'denyBusyInvitation',
			type: 'boolean',
			default: false,
			description: 'Whether others are stopped from inviting the user at a time already taken',
		},
		{
			displayName: 'Send Invitations From Email',
			name: 'sendFromEmail',
			type: 'string',
			default: '',
			placeholder: 'name@example.com',
			description: 'Address mail invitations are sent from',
		},
		{
			displayName: 'Show Completed Tasks',
			name: 'showCompletedTasks',
			type: 'boolean',
			default: false,
			description: 'Whether finished tasks stay in the calendar grid',
		},
		{
			displayName: 'Show Declined Events',
			name: 'showDeclined',
			type: 'boolean',
			default: false,
			description: 'Whether events the user declined stay in the grid',
		},
		{
			displayName: 'Show Tasks',
			name: 'showTasks',
			type: 'boolean',
			default: false,
			description: 'Whether tasks with a deadline appear in the calendar',
		},
		{
			displayName: 'Show Week Numbers',
			name: 'showWeekNumbers',
			type: 'boolean',
			default: false,
			description: 'Whether the grid numbers the weeks of the year',
		},
		{
			displayName: 'Sync Months Ahead',
			name: 'syncPeriodFuture',
			type: 'number',
			default: 3,
			description: 'How many months ahead outside calendars are synchronised',
		},
		{
			displayName: 'Sync Months Back',
			name: 'syncPeriodPast',
			type: 'number',
			default: 3,
			description: 'How many months back outside calendars are synchronised',
		},
		{
			displayName: 'Sync Task Calendar',
			name: 'syncTasks',
			type: 'boolean',
			default: false,
			description: 'Whether the task calendar is synchronised with outside calendars',
		},
	],
};

const settingsJsonProperty: INodeProperties = {
	displayName: 'Settings (JSON)',
	name: 'settingsJson',
	type: 'json',
	default: '{}',
	description:
		'Settings merged over the ones above, for what has no field here: defaultReminders and defaultSections, e.g. {"defaultReminders": {"withTime": [{"type": "min", "count": 15}]}}',
};

export const settingsResource: Resource = {
	value: 'settings',
	name: 'Settings',
	description: 'Working hours and holidays of the portal, and the calendar settings of the webhook user',
	operations: [
		{
			value: 'getPortal',
			name: 'Get Portal Settings',
			action: 'Get the calendar settings of the portal',
			description: 'Read the working hours, weekends and holidays every calendar of the portal follows',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'calendar.settings.get', {}, { itemIndex });
				return (body.result ?? {}) as IDataObject;
			},
		},
		{
			value: 'getUser',
			name: 'Get User Settings',
			action: 'Get the calendar settings of the webhook user',
			description: 'Read the personal calendar settings of the user the webhook acts as, its time zone included',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'calendar.user.settings.get', {}, { itemIndex });
				return (body.result ?? {}) as IDataObject;
			},
		},
		{
			value: 'updateUser',
			name: 'Update User Settings',
			action: 'Update the calendar settings of the webhook user',
			description: 'Change the personal calendar settings of the user the webhook acts as',
			properties: [userSettingsProperty, settingsJsonProperty],
			async execute(itemIndex) {
				const chosen = (this.getNodeParameter('settings', itemIndex, {}) ?? {}) as IDataObject;
				const settings: IDataObject = {
					...compact({
						view: chosen.view,
						meetSection: chosen.meetSection,
						crmSection: chosen.crmSection,
						lastUsedSection: chosen.lastUsedSection,
						sendFromEmail: chosen.sendFromEmail,
						showDeclined: chosen.showDeclined,
						denyBusyInvitation: chosen.denyBusyInvitation,
						collapseOffHours: yn(chosen.collapseOffHours),
						showWeekNumbers: yn(chosen.showWeekNumbers),
						showTasks: yn(chosen.showTasks),
						showCompletedTasks: yn(chosen.showCompletedTasks),
						syncTasks: yn(chosen.syncTasks),
						syncPeriodPast: chosen.syncPeriodPast,
						syncPeriodFuture: chosen.syncPeriodFuture,
					}),
					...jsonParameter<IDataObject>(this, 'settingsJson', itemIndex, {}),
				};

				if (Object.keys(settings).length === 0) {
					throw new NodeOperationError(this.getNode(), 'No setting to change', {
						itemIndex,
						description: 'Add at least one setting, or write it into Settings (JSON).',
					});
				}

				await bitrix24Request.call(this, 'calendar.user.settings.set', { settings }, { itemIndex });
				return undefined;
			},
		},
	],
};
