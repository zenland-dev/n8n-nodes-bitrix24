import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { offsetList, valuesOf } from '../../../shared/offset';
import { returnAllProperties, stringList } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { idList, optionalInt } from '../../../shared/values';

const STAT_PAGE = 200;
/** The documented caps of the batch methods. */
const STAT_BATCH = 100;
const TRANSFER_BATCH = 50;

function dateProperty(displayName: string, name: string, description: string): INodeProperties {
	return { displayName, name, type: 'dateTime', required: true, default: '', description };
}

const scopeOptions: INodeProperties[] = [
	{ displayName: 'Channel Codes', name: 'sources', type: 'string', default: '', placeholder: 'livechat, telegrambot', description: 'Comma-separated connector codes the conversations came through' },
	{ displayName: 'Open Line IDs', name: 'lineIds', type: 'string', default: '', placeholder: '1, 3', description: 'Comma-separated open line IDs' },
	{ displayName: 'Operator IDs', name: 'operatorIds', type: 'string', default: '', placeholder: '7, 15', description: 'Comma-separated user IDs of operators' },
];

/** Lines, channels and operators, as the list forms the methods take. */
function scopeParams(ctx: IExecuteFunctions, f: IDataObject, itemIndex: number, operatorKey = 'operatorIdList'): IDataObject {
	const params: IDataObject = {};
	const lines = idList(ctx, f.lineIds, 'Open Line IDs', itemIndex);
	if (lines.length > 0) params.configIdList = lines;
	const operators = idList(ctx, f.operatorIds, 'Operator IDs', itemIndex);
	if (operators.length > 0) params[operatorKey] = operators;
	const sources = stringList(f.sources);
	if (sources.length > 0) params.sourceList = sources;
	return params;
}

function isoDate(ctx: IExecuteFunctions, name: string, label: string, itemIndex: number): string {
	const value = String(ctx.getNodeParameter(name, itemIndex) ?? '').trim();
	if (value === '') throw new NodeOperationError(ctx.getNode(), `${label} is required`, { itemIndex });
	return value;
}

function sessionIds(ctx: IExecuteFunctions, itemIndex: number): number[] {
	const ids = [...new Set(idList(ctx, ctx.getNodeParameter('sessionIds', itemIndex), 'Session IDs', itemIndex))];
	if (ids.length === 0) throw new NodeOperationError(ctx.getNode(), 'Session IDs: give at least one session', { itemIndex });
	return ids;
}

function chunks<T>(list: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out;
}

const sessionIdsProperty: INodeProperties = { displayName: 'Session IDs', name: 'sessionIds', type: 'string', required: true, default: '', placeholder: '3567, 3568', description: 'Comma-separated session IDs, e.g. from Get Sessions' };

function sorted(options: INodeProperties[]): INodeProperties[] {
	return options.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

const flag = (displayName: string, name: string, description: string): INodeProperties => ({ displayName, name, type: 'boolean', default: true, description });

export const statisticsResource: Resource = {
	value: 'statistics',
	name: 'Statistics',
	description: 'Contact center reports: totals, sessions, ratings, transfers and operator load',
	operations: [
		{
			value: 'getSummary',
			name: 'Get Summary',
			action: 'Get open line totals for a period',
			description: 'Count sessions, answer times, likes and first-answer KPI for a period, with breakdowns by channel, hour and operator',
			properties: [
				dateProperty('Date From', 'dateFrom', 'Start of the period'),
				dateProperty('Date To', 'dateTo', 'End of the period, at most 366 days after the start'),
				{ displayName: 'Filters', name: 'filters', type: 'collection', placeholder: 'Add Filter', default: {}, options: scopeOptions },
			],
			async execute(itemIndex) {
				const f = (this.getNodeParameter('filters', itemIndex, {}) ?? {}) as IDataObject;
				const params = { dateFrom: isoDate(this, 'dateFrom', 'Date From', itemIndex), dateTo: isoDate(this, 'dateTo', 'Date To', itemIndex), ...scopeParams(this, f, itemIndex) };
				const body = await bitrix24Request.call(this, 'imopenlines.v2.Stat.get', params, { itemIndex });
				return { dateFrom: params.dateFrom, dateTo: params.dateTo, ...((body.result ?? {}) as IDataObject) };
			},
		},
		{
			value: 'getSessions',
			name: 'Get Sessions',
			action: 'Get open line sessions',
			description: 'List conversation sessions with their channel, operator, times, ratings and CRM link',
			properties: [
				...returnAllProperties('sessions'),
				{
					displayName: 'Filters',
					name: 'filters',
					type: 'collection',
					placeholder: 'Add Filter',
					default: {},
					options: sorted([
						...scopeOptions,
						{ displayName: 'Closed From', name: 'dateCloseFrom', type: 'dateTime', default: '' },
						{ displayName: 'Closed To', name: 'dateCloseTo', type: 'dateTime', default: '', description: 'At most 366 days after Closed From' },
						{
							displayName: 'Close Reason',
							name: 'closeReason',
							type: 'options',
							default: 'operator',
							description: 'Cannot be combined with Status',
							options: [
								{ name: 'Automatically by Timeout', value: 'auto' },
								{ name: 'By Operator', value: 'operator' },
								{ name: 'Client Inactive', value: 'client' },
								{ name: 'Reply Window Expired', value: 'replyLimit' },
								{ name: 'Spam', value: 'spam' },
							],
						},
						{ displayName: 'Created From', name: 'dateCreateFrom', type: 'dateTime', default: '' },
						{ displayName: 'Created To', name: 'dateCreateTo', type: 'dateTime', default: '', description: 'At most 366 days after Created From' },
						flag('First Answer KPI Met', 'kpiFirstAnswer', 'Whether the first answer came in time (on) or late (off). Needs a full created or closed period.'),
						flag('Has CRM Link', 'hasCrm', 'Whether the session is linked to a CRM record the webhook user can see'),
						flag('Has Supervisor Rating', 'hasVoteHead', 'Whether a supervisor has rated the session'),
						{ displayName: 'Max Wait for Answer (Seconds)', name: 'waitAnswerTo', type: 'number', default: 0 },
						{ displayName: 'Max Wait to Close (Seconds)', name: 'waitCloseTo', type: 'number', default: 0 },
						{ displayName: 'Min Wait for Answer (Seconds)', name: 'waitAnswerFrom', type: 'number', default: 0 },
						{ displayName: 'Min Wait to Close (Seconds)', name: 'waitCloseFrom', type: 'number', default: 0 },
						{
							displayName: 'Rating',
							name: 'vote',
							type: 'options',
							default: 'like',
							options: [
								{ name: 'Any Rating', value: 'any' },
								{ name: 'Dislike', value: 'dislike' },
								{ name: 'Like', value: 'like' },
								{ name: 'No Rating', value: 'none' },
							],
						},
						{
							displayName: 'Sort By',
							name: 'order',
							type: 'options',
							default: 'dateCreate',
							description: 'Anything but creation date needs a full created or closed period',
							options: [
								{ name: 'Close Date', value: 'dateClose' },
								{ name: 'Creation Date', value: 'dateCreate' },
								{ name: 'Time to Close', value: 'waitClose' },
								{ name: 'Time to First Answer', value: 'waitAnswer' },
							],
						},
						{ displayName: 'Sort Ascending', name: 'ascending', type: 'boolean', default: true, description: 'Whether to sort oldest or smallest first instead of newest or largest' },
						{
							displayName: 'Status',
							name: 'status',
							type: 'options',
							default: 'closed',
							options: [
								{ name: 'Closed', value: 'closed' },
								{ name: 'In Progress', value: 'answered' },
								{ name: 'New or Missed', value: 'new' },
								{ name: 'Paused', value: 'paused' },
								{ name: 'Spam', value: 'spam' },
							],
						},
					]),
				},
			],
			async execute(itemIndex) {
				const f = (this.getNodeParameter('filters', itemIndex, {}) ?? {}) as IDataObject;
				if (f.status !== undefined && f.closeReason !== undefined) throw new NodeOperationError(this.getNode(), 'Status and Close Reason cannot be combined', { itemIndex });
				const params: IDataObject = scopeParams(this, f, itemIndex);
				for (const key of ['status', 'closeReason', 'vote', 'order', 'dateCreateFrom', 'dateCreateTo', 'dateCloseFrom', 'dateCloseTo']) {
					if (typeof f[key] === 'string' && f[key] !== '') params[key] = f[key];
				}
				for (const key of ['kpiFirstAnswer', 'hasCrm', 'hasVoteHead']) if (typeof f[key] === 'boolean') params[key] = f[key];
				for (const key of ['waitAnswerFrom', 'waitAnswerTo', 'waitCloseFrom', 'waitCloseTo']) if (optionalInt(f[key]) !== undefined) params[key] = Number(f[key]);
				if (f.ascending !== undefined) params.orderDirection = f.ascending === true ? 'asc' : 'desc';
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				return await offsetList.call(this, 'imopenlines.v2.Session.list', params, {
					pageSize: STAT_PAGE,
					offsetKey: 'offset',
					limitKey: 'limit',
					itemsKey: 'sessions',
					limit: returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number),
					itemIndex,
				});
			},
		},
		{
			value: 'getSessionMetrics',
			name: 'Get Session Metrics',
			action: 'Get metrics of sessions',
			description: 'Get wait times, message counts, transfers, KPI and ratings of given sessions; any number of IDs, 100 per request',
			properties: [sessionIdsProperty],
			async execute(itemIndex) {
				const out: IDataObject[] = [];
				for (const batch of chunks(sessionIds(this, itemIndex), STAT_BATCH)) {
					const body = await bitrix24Request.call(this, 'imopenlines.v2.Session.Stat.get', { sessionId: batch }, { itemIndex });
					const result = (body.result ?? {}) as IDataObject;
					out.push(...valuesOf(result.sessions ?? result.stats));
				}
				return out;
			},
		},
		{
			value: 'getTransfers',
			name: 'Get Transfers',
			action: 'Get the transfer history of sessions',
			description: 'List who passed given sessions to whom, when and why; any number of IDs, 50 per request',
			properties: [sessionIdsProperty],
			async execute(itemIndex) {
				const out: IDataObject[] = [];
				for (const batch of chunks(sessionIds(this, itemIndex), TRANSFER_BATCH)) {
					const body = await bitrix24Request.call(this, 'imopenlines.v2.Session.Transfer.list', { sessionId: batch }, { itemIndex });
					out.push(...valuesOf(((body.result ?? {}) as IDataObject).transfers));
				}
				return out;
			},
		},
		{
			value: 'getRatings',
			name: 'Get Ratings',
			action: 'Get client ratings',
			description: 'List sessions clients rated in a period, with supervisor ratings and comments where the webhook user may see them',
			properties: [
				dateProperty('Rated From', 'dateFrom', 'Start of the rating period'),
				dateProperty('Rated To', 'dateTo', 'End of the rating period, at most 366 days after the start'),
				...returnAllProperties('ratings'),
				{
					displayName: 'Filters',
					name: 'filters',
					type: 'collection',
					placeholder: 'Add Filter',
					default: {},
					options: sorted([
						...scopeOptions,
						flag('Has Supervisor Rating', 'hasVoteHead', 'Whether a supervisor has rated the session'),
						{
							displayName: 'Rating',
							name: 'vote',
							type: 'options',
							default: 'like',
							options: [
								{ name: 'Dislike', value: 'dislike' },
								{ name: 'Like', value: 'like' },
							],
						},
					]),
				},
			],
			async execute(itemIndex) {
				const f = (this.getNodeParameter('filters', itemIndex, {}) ?? {}) as IDataObject;
				const params: IDataObject = { dateVoteFrom: isoDate(this, 'dateFrom', 'Rated From', itemIndex), dateVoteTo: isoDate(this, 'dateTo', 'Rated To', itemIndex), ...scopeParams(this, f, itemIndex) };
				if (typeof f.vote === 'string') params.vote = f.vote;
				if (typeof f.hasVoteHead === 'boolean') params.hasVoteHead = f.hasVoteHead;
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				return await offsetList.call(this, 'imopenlines.v2.Session.Rating.list', params, {
					pageSize: STAT_PAGE,
					offsetKey: 'offset',
					limitKey: 'limit',
					itemsKey: 'ratings',
					limit: returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number),
					itemIndex,
				});
			},
		},
		{
			value: 'getOperatorLoad',
			name: 'Get Operator Load',
			action: 'Get operator status and load',
			description: 'List operators with their status, active conversations and free slots, per line. Refresh no more than every 30 seconds.',
			properties: [
				...returnAllProperties('operators'),
				{
					displayName: 'Filters',
					name: 'filters',
					type: 'collection',
					placeholder: 'Add Filter',
					default: {},
					options: [
						flag('Has Free Slots', 'hasFreeSlots', 'Whether the operator can take another conversation'),
						{ displayName: 'Open Line IDs', name: 'lineIds', type: 'string', default: '', placeholder: '1, 3', description: 'Comma-separated open line IDs' },
						{ displayName: 'Operator IDs', name: 'operatorIds', type: 'string', default: '', placeholder: '7, 15', description: 'Comma-separated user IDs of operators' },
						{
							displayName: 'Status',
							name: 'status',
							type: 'options',
							default: 'online',
							options: [
								{ name: 'Offline', value: 'offline' },
								{ name: 'Online', value: 'online' },
								{ name: 'Paused', value: 'pause' },
							],
						},
					],
				},
			],
			async execute(itemIndex) {
				const f = (this.getNodeParameter('filters', itemIndex, {}) ?? {}) as IDataObject;
				const params: IDataObject = scopeParams(this, { lineIds: f.lineIds, operatorIds: f.operatorIds }, itemIndex, 'userIdList');
				if (typeof f.status === 'string') params.status = f.status;
				if (typeof f.hasFreeSlots === 'boolean') params.hasFreeSlots = f.hasFreeSlots;
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				return await offsetList.call(this, 'imopenlines.v2.Operator.list', params, {
					pageSize: STAT_PAGE,
					offsetKey: 'offset',
					limitKey: 'limit',
					itemsKey: 'operators',
					limit: returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number),
					itemIndex,
				});
			},
		},
	],
};
