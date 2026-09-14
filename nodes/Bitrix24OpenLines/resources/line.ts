import type { IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { ATTACH_DESCRIPTION, KEYBOARD_DESCRIPTION, optionalJson } from '../../../shared/messages';
import { offsetList } from '../../../shared/offset';
import { jsonParameter, returnAllProperties } from '../../../shared/params';
import { numberProperty, positiveInt, rows } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { yn } from '../../../shared/values';
import { lineParams, lineProperty, lineSettings, readLineId } from '../shared/helpers';

const networkCodeProperty = {
	displayName: 'Network Line Code',
	name: 'code',
	type: 'string' as const,
	required: true,
	default: '',
	placeholder: 'ab515f5d85a8b844d484f6ea75a2e494',
	description: 'The 32-character code of an open channel published in Bitrix24.Network, from its card in the Contact Center',
};

function networkCode(value: unknown): string {
	return String(value ?? '').trim();
}

export const lineResource: Resource = {
	value: 'line',
	name: 'Open Line',
	description: 'Open channels: their queues, working hours, CRM and automatic messages',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Create an open line',
			description: 'Create an open channel with a queue of operators and its rules',
			properties: [
				{ displayName: 'Name', name: 'name', type: 'string', required: true, default: '' },
				{ displayName: 'Settings', name: 'settings', type: 'collection', placeholder: 'Add Setting', default: {}, options: lineSettings(false) },
			],
			async execute(itemIndex) {
				const name = String(this.getNodeParameter('name', itemIndex) ?? '').trim();
				if (name === '') throw new NodeOperationError(this.getNode(), 'Name is required', { itemIndex });
				const settings = (this.getNodeParameter('settings', itemIndex, {}) ?? {}) as IDataObject;
				const params = lineParams(this, { ...settings, name }, itemIndex);
				const body = await bitrix24Request.call(this, 'imopenlines.config.add', { PARAMS: params }, { itemIndex });
				return { lineId: Number(body.result), name };
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get an open line',
			description: 'Retrieve the settings of an open channel, optionally with its operator queue',
			properties: [
				lineProperty(),
				{ displayName: 'Include Queue', name: 'withQueue', type: 'boolean', default: false, description: 'Whether to add the operators of the queue' },
				{ displayName: 'Include Offline Operators', name: 'showOffline', type: 'boolean', default: false, displayOptions: { show: { withQueue: [true] } } },
			],
			async execute(itemIndex) {
				const id = readLineId(this, itemIndex);
				const params: IDataObject = { CONFIG_ID: id };
				if (this.getNodeParameter('withQueue', itemIndex, false) === true) {
					params.WITH_QUEUE = 'Y';
					params.SHOW_OFFLINE = yn(this.getNodeParameter('showOffline', itemIndex, false));
				}
				const body = await bitrix24Request.call(this, 'imopenlines.config.get', params, { itemIndex });
				if (body.result === false) throw new NodeOperationError(this.getNode(), `Open line ${id} was not found`, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many open lines',
			description: 'List the open channels the webhook user can see',
			properties: [
				...returnAllProperties('open lines'),
				{ displayName: 'Filter (JSON)', name: 'filterJson', type: 'json', default: '{}', description: 'Filter by setting names, e.g. {"ACTIVE": "Y"}' },
				{ displayName: 'Include Queue', name: 'withQueue', type: 'boolean', default: false, description: 'Whether to add the user IDs of each queue' },
				{ displayName: 'Order (JSON)', name: 'orderJson', type: 'json', default: '{}', description: 'Sort by setting names, e.g. {"LINE_NAME": "asc"}' },
				{ displayName: 'Fields to Return', name: 'select', type: 'string', default: '', placeholder: 'ID, LINE_NAME, ACTIVE', description: 'Comma-separated setting names. Leave empty for all.' },
			],
			async execute(itemIndex) {
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const inner: IDataObject = {};
				const filter = jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {});
				if (Object.keys(filter).length > 0) inner.filter = filter;
				const order = jsonParameter<IDataObject>(this, 'orderJson', itemIndex, {});
				inner.order = Object.keys(order).length > 0 ? order : { ID: 'asc' };
				const select = String(this.getNodeParameter('select', itemIndex, '') ?? '')
					.split(',')
					.map((s) => s.trim())
					.filter((s) => s !== '');
				if (select.length > 0) inner.select = select;
				const params: IDataObject = { PARAMS: inner };
				if (this.getNodeParameter('withQueue', itemIndex, false) === true) params.OPTIONS = { QUEUE: 'Y' };
				return await offsetList.call(this, 'imopenlines.config.list.get', params, {
					pageSize: 200,
					offsetKey: 'offset',
					limitKey: 'limit',
					nestedIn: 'PARAMS',
					limit: returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number),
					itemIndex,
				});
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update an open line',
			description: 'Change settings of an open channel; settings not given stay as they are',
			properties: [lineProperty(), { displayName: 'Settings', name: 'settings', type: 'collection', placeholder: 'Add Setting', default: {}, options: lineSettings(true) }],
			async execute(itemIndex) {
				const id = readLineId(this, itemIndex);
				const params = lineParams(this, (this.getNodeParameter('settings', itemIndex, {}) ?? {}) as IDataObject, itemIndex);
				if (Object.keys(params).length === 0) throw new NodeOperationError(this.getNode(), 'Nothing to update: add at least one setting', { itemIndex });
				const body = await bitrix24Request.call(this, 'imopenlines.config.update', { CONFIG_ID: id, PARAMS: params }, { itemIndex });
				if (body.result === false) throw new NodeOperationError(this.getNode(), `Open line ${id} was not found`, { itemIndex });
				return { lineId: id, updated: true };
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete an open line',
			description: 'Delete an open channel',
			properties: [lineProperty()],
			async execute(itemIndex) {
				const id = readLineId(this, itemIndex);
				const body = await bitrix24Request.call(this, 'imopenlines.config.delete', { CONFIG_ID: id }, { itemIndex });
				if (body.result === false) throw new NodeOperationError(this.getNode(), `Open line ${id} was not found`, { itemIndex });
				return { lineId: id, deleted: true };
			},
		},
		{
			value: 'getPublicPage',
			name: 'Get Public Page Link',
			action: 'Get the public page of open lines',
			description: 'Get the address of the public page with the portal\'s open channels',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'imopenlines.config.path.get', {}, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'joinNetwork',
			name: 'Connect Network Line',
			action: 'Connect an open line from Bitrix24.Network',
			description: 'Connect an open channel another company published in Bitrix24.Network, so its clients can be answered here',
			properties: [networkCodeProperty],
			async execute(itemIndex) {
				const code = networkCode(this.getNodeParameter('code', itemIndex));
				if (!/^[0-9a-f]{32}$/i.test(code)) throw new NodeOperationError(this.getNode(), 'Network Line Code must be 32 hexadecimal characters', { itemIndex });
				const body = await bitrix24Request.call(this, 'imopenlines.network.join', { CODE: code }, { itemIndex });
				return { code, botId: Number(body.result) };
			},
		},
		{
			value: 'sendNetworkMessage',
			name: 'Send Network Message',
			action: 'Send a message from a Bitrix24.Network line',
			description: 'Write to a user on behalf of an open channel connected in Bitrix24.Network; at most once a week per user',
			properties: [
				networkCodeProperty,
				numberProperty('User ID', 'userId', 'Who receives the message'),
				{ displayName: 'Text', name: 'text', type: 'string', typeOptions: { rows: 4 }, required: true, default: '' },
				{
					displayName: 'Additional Fields',
					name: 'additionalFields',
					type: 'collection',
					placeholder: 'Add Field',
					default: {},
					options: [
						{ displayName: 'Attachment (JSON)', name: 'attach', type: 'json', default: '{}', description: ATTACH_DESCRIPTION },
						{ displayName: 'Keyboard (JSON)', name: 'keyboard', type: 'json', default: '{}', description: `${KEYBOARD_DESCRIPTION} Here only link buttons work` },
						{ displayName: 'Link Preview', name: 'urlPreview', type: 'boolean', default: true },
					],
				},
			],
			async execute(itemIndex) {
				const code = networkCode(this.getNodeParameter('code', itemIndex));
				if (!/^[0-9a-f]{32}$/i.test(code)) throw new NodeOperationError(this.getNode(), 'Network Line Code must be 32 hexadecimal characters', { itemIndex });
				const text = String(this.getNodeParameter('text', itemIndex) ?? '');
				if (text.trim() === '') throw new NodeOperationError(this.getNode(), 'Text is required', { itemIndex });
				const o = (this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject;
				const params: IDataObject = { CODE: code, USER_ID: positiveInt(this, 'userId', itemIndex, 'User ID'), MESSAGE: text };
				const attach = optionalJson(this, o.attach, 'Attachment (JSON)', itemIndex);
				if (attach !== undefined) params.ATTACH = attach;
				const keyboard = optionalJson(this, o.keyboard, 'Keyboard (JSON)', itemIndex);
				if (keyboard !== undefined) params.KEYBOARD = keyboard;
				if (o.urlPreview !== undefined) params.URL_PREVIEW = yn(o.urlPreview);
				const body = await bitrix24Request.call(this, 'imopenlines.network.message.add', params, { itemIndex });
				return { code, userId: params.USER_ID, sent: body.result === true };
			},
		},
	],
};
