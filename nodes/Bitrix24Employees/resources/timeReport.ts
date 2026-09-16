import type { IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { compact } from '../../../shared/params';
import { numberProperty } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { idList } from '../../../shared/values';
import { optionalId, requiredId } from '../shared/helpers';

const REPORT_AUDIENCE = [
	{ name: 'Everyone', value: 'all' },
	{ name: 'Nobody', value: 'none' },
	{ name: 'Only Chosen Employees', value: 'user' },
];

export const timeReportResource: Resource = {
	value: 'timeReport',
	name: 'Work Time Report',
	description: 'Time control: monthly reports of worked hours and the absences an employee explains',
	operations: [
		{
			value: 'addReport',
			name: 'Explain an Absence',
			action: 'Explain an absence',
			description:
				'Write the reason for a recorded absence, the way an employee answers the time control question',
			properties: [
				numberProperty('Absence Record ID', 'reportId', 'ID of the absence, as Get Reports returns it in reports.id'),
				{
					displayName: 'Text',
					name: 'text',
					type: 'string',
					required: true,
					typeOptions: { rows: 3 },
					default: '',
					description: 'What the employee was doing',
				},
				{
					displayName: 'Type',
					name: 'type',
					type: 'options',
					default: 'PRIVATE',
					options: [
						{ name: 'Personal', value: 'PRIVATE' },
						{ name: 'Work', value: 'WORK' },
					],
					description: 'Whether the absence was work-related or personal',
				},
				{
					displayName: 'Add to Calendar',
					name: 'calendar',
					type: 'boolean',
					default: true,
					description: 'Whether the absence also becomes an event in the calendar',
				},
				{
					displayName: 'Employee ID',
					name: 'userId',
					type: 'number',
					default: 0,
					description: 'Whose absence it is. Only an administrator may answer for somebody else.',
				},
			],
			async execute(itemIndex) {
				const params = compact({
					REPORT_ID: requiredId(this, 'reportId', itemIndex, 'Absence Record ID'),
					TEXT: this.getNodeParameter('text', itemIndex),
					TYPE: this.getNodeParameter('type', itemIndex, 'PRIVATE'),
					CALENDAR: (this.getNodeParameter('calendar', itemIndex, true) as boolean) ? 'Y' : 'N',
					USER_ID: optionalId(this, 'userId', itemIndex),
				});
				await bitrix24Request.call(this, 'timeman.timecontrol.report.add', params, { itemIndex });
				return undefined;
			},
		},
		{
			value: 'getReports',
			name: 'Get Reports',
			action: 'Get the time report of an employee',
			description:
				'Read a month of an employee: every working day, how long it lasted against the schedule, and the absences recorded in it',
			properties: [
				numberProperty('Employee ID', 'userId', 'Whose month to read'),
				{
					displayName: 'Month',
					name: 'month',
					type: 'number',
					required: true,
					typeOptions: { minValue: 1, maxValue: 12 },
					default: 1,
				},
				{
					displayName: 'Year',
					name: 'year',
					type: 'number',
					required: true,
					default: 2026,
				},
				{
					displayName: 'Options',
					name: 'options',
					type: 'collection',
					placeholder: 'Add Option',
					default: {},
					options: [
						{
							displayName: 'Idle Minutes',
							name: 'IDLE_MINUTES',
							type: 'number',
							default: 0,
							description:
								'How long an employee may be away before it counts as an absence. Empty takes the portal setting.',
						},
						{
							displayName: 'Workday Hours',
							name: 'WORKDAY_HOURS',
							type: 'number',
							default: 8,
							description: 'How long a full working day is, for counting what was underworked',
						},
					],
				},
			],
			async execute(itemIndex) {
				const options = (this.getNodeParameter('options', itemIndex, {}) ?? {}) as IDataObject;
				const month = Number(this.getNodeParameter('month', itemIndex));
				if (!Number.isInteger(month) || month < 1 || month > 12) {
					throw new NodeOperationError(this.getNode(), 'Month must be a number from 1 to 12', { itemIndex });
				}
				const params = compact({
					USER_ID: requiredId(this, 'userId', itemIndex, 'Employee ID'),
					MONTH: month,
					YEAR: Number(this.getNodeParameter('year', itemIndex)),
					IDLE_MINUTES: Number(options.IDLE_MINUTES ?? 0) > 0 ? Number(options.IDLE_MINUTES) : undefined,
					WORKDAY_HOURS: Number(options.WORKDAY_HOURS ?? 0) > 0 ? Number(options.WORKDAY_HOURS) : undefined,
				});
				const body = await bitrix24Request.call(this, 'timeman.timecontrol.reports.get', params, { itemIndex });
				return (body.result ?? {}) as IDataObject;
			},
		},
		{
			value: 'getReportUsers',
			name: 'Get Report Employees',
			action: 'Get the employees whose reports are readable',
			description: 'List the employees the webhook user may read time reports of, optionally within one department',
			properties: [
				{
					displayName: 'Department Name or ID',
					name: 'departmentId',
					type: 'options',
					typeOptions: { loadOptionsMethod: 'getDepartments' },
					default: '',
					description:
						'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
					hint: 'Leave empty to ask for every employee available',
				},
			],
			async execute(itemIndex) {
				const params = compact({ DEPARTMENT_ID: optionalId(this, 'departmentId', itemIndex) });
				const body = await bitrix24Request.call(this, 'timeman.timecontrol.reports.users.get', params, { itemIndex });
				return Array.isArray(body.result) ? (body.result as IDataObject[]) : [];
			},
		},
		{
			value: 'getReportAccess',
			name: 'Get Report Access',
			action: 'Get what the webhook user may see in time reports',
			description:
				'Read whether time control is on, whether the webhook user is an administrator or a head of department, and which departments they see',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'timeman.timecontrol.reports.settings.get', {}, { itemIndex });
				return (body.result ?? {}) as IDataObject;
			},
		},
		{
			value: 'getSettings',
			name: 'Get Settings',
			action: 'Get the time control settings',
			description: 'Read the portal settings of time control: what is recorded and who is asked for reports',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'timeman.timecontrol.settings.get', {}, { itemIndex });
				return (body.result ?? {}) as IDataObject;
			},
		},
		{
			value: 'updateSettings',
			name: 'Update Settings',
			action: 'Update the time control settings',
			description:
				'Change what time control records and who it asks for reports, for the whole portal. Needs an administrator webhook.',
			properties: [
				{
					displayName: 'Settings',
					name: 'settings',
					type: 'collection',
					placeholder: 'Add Setting',
					default: {},
					description: 'What you leave out stays as it is',
					options: [
						{
							displayName: 'Active',
							name: 'ACTIVE',
							type: 'boolean',
							default: true,
							description: 'Whether time control works at all on this portal',
						},
						{
							displayName: 'Full Report Audience',
							name: 'REPORT_FULL_TYPE',
							type: 'options',
							default: 'none',
							options: REPORT_AUDIENCE,
							description: 'Who may read the full report, with system descriptions of every absence',
						},
						{
							displayName: 'Full Report Employee IDs',
							name: 'REPORT_FULL_USERS',
							type: 'string',
							default: '',
							placeholder: '12, 34',
							description: 'Comma-separated employees, when the audience above is Only Chosen Employees',
						},
						{
							displayName: 'Minimum Idle for a Report',
							name: 'MINIMUM_IDLE_FOR_REPORT',
							type: 'number',
							default: 15,
							description: 'How many minutes away from the workplace before an explanation is asked for',
						},
						{
							displayName: 'Record Desktop App',
							name: 'REGISTER_DESKTOP',
							type: 'boolean',
							default: false,
							description: 'Whether starting and closing the desktop application is recorded',
						},
						{
							displayName: 'Record Idle',
							name: 'REGISTER_IDLE',
							type: 'boolean',
							default: false,
							description: 'Whether stepping away from the computer is recorded',
						},
						{
							displayName: 'Record Offline',
							name: 'REGISTER_OFFLINE',
							type: 'boolean',
							default: false,
							description: 'Whether going offline is recorded',
						},
						{
							displayName: 'Report Request Audience',
							name: 'REPORT_REQUEST_TYPE',
							type: 'options',
							default: 'none',
							options: REPORT_AUDIENCE,
							description: 'Who is asked to explain their absences',
						},
						{
							displayName: 'Report Request Employee IDs',
							name: 'REPORT_REQUEST_USERS',
							type: 'string',
							default: '',
							placeholder: '12, 34',
							description: 'Comma-separated employees, when the audience above is Only Chosen Employees',
						},
						{
							displayName: 'Simple Report Audience',
							name: 'REPORT_SIMPLE_TYPE',
							type: 'options',
							default: 'none',
							options: REPORT_AUDIENCE,
							description: 'Who may read the simple report',
						},
						{
							displayName: 'Simple Report Employee IDs',
							name: 'REPORT_SIMPLE_USERS',
							type: 'string',
							default: '',
							placeholder: '12, 34',
							description: 'Comma-separated employees, when the audience above is Only Chosen Employees',
						},
					],
				},
			],
			async execute(itemIndex) {
				const chosen = { ...((this.getNodeParameter('settings', itemIndex, {}) ?? {}) as IDataObject) };
				if (Object.keys(chosen).length === 0) {
					throw new NodeOperationError(this.getNode(), 'No setting to change', { itemIndex });
				}
				for (const key of ['REPORT_FULL_USERS', 'REPORT_REQUEST_USERS', 'REPORT_SIMPLE_USERS']) {
					if (chosen[key] !== undefined) chosen[key] = idList(this, chosen[key], key, itemIndex);
				}
				// ACTIVE: false does not switch the module off, 0 does.
				if (chosen.ACTIVE !== undefined) chosen.ACTIVE = chosen.ACTIVE === true ? true : 0;

				await bitrix24Request.call(this, 'timeman.timecontrol.settings.set', compact(chosen), { itemIndex });
				return undefined;
			},
		},
	],
};
