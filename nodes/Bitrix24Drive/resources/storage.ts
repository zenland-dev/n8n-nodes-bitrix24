import type { IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { compact, returnAllProperties } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import {
	fieldRows,
	filterJsonProperty,
	jsonObject,
	limitOf,
	offsetRows,
	orderJsonProperty,
	readId,
	storageIdProperty,
	withoutLink,
	withoutLinks,
} from '../shared/helpers';

const OWNER_TYPES = { user: 'user', group: 'group', common: 'common' } as const;

export const storageResource: Resource = {
	value: 'storage',
	name: 'Storage',
	description: 'Drives: a user\'s, a workgroup\'s and the company one, with their root folders',
	operations: [
		{
			value: 'getByOwner',
			name: 'Get by Owner',
			action: 'Get the drive of a user or workgroup',
			description: 'Find the drive of the webhook user, another user, a workgroup or the company, with the ID of its root folder',
			properties: [
				{
					displayName: 'Owner',
					name: 'ownerType',
					type: 'options',
					default: 'me',
					options: [
						{ name: 'Company', value: 'common', description: 'The shared company drive' },
						{ name: 'User', value: 'user', description: 'The personal drive of a user' },
						{ name: 'Webhook User', value: 'me', description: 'The personal drive of the user who owns the webhook' },
						{ name: 'Workgroup', value: 'group', description: 'The drive of a workgroup or project' },
					],
				},
				{
					displayName: 'Owner ID',
					name: 'ownerId',
					type: 'number',
					required: true,
					default: 0,
					displayOptions: { show: { ownerType: ['user', 'group'] } },
					description: 'ID of the user or of the workgroup',
				},
			],
			async execute(itemIndex) {
				const ownerType = String(this.getNodeParameter('ownerType', itemIndex));
				let filter: IDataObject;
				if (ownerType === 'me') {
					const profile = await bitrix24Request.call(this, 'profile', {}, { itemIndex });
					filter = { ENTITY_TYPE: OWNER_TYPES.user, ENTITY_ID: String((profile.result as IDataObject | null)?.ID ?? '') };
				} else if (ownerType === 'common') {
					filter = { ENTITY_TYPE: OWNER_TYPES.common };
				} else {
					filter = { ENTITY_TYPE: ownerType === 'group' ? OWNER_TYPES.group : OWNER_TYPES.user, ENTITY_ID: String(readId(this, 'ownerId', itemIndex, 'Owner ID')) };
				}
				const rows = await offsetRows(this, 'disk.storage.getList', { filter }, { itemIndex, limit: 50 });
				if (rows.length === 0) {
					throw new NodeOperationError(this.getNode(), 'No drive found for this owner', {
						itemIndex,
						description: 'The webhook user sees only drives it may read. A workgroup without Drive enabled has none.',
					});
				}
				return withoutLinks(rows);
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get a drive',
			description: 'Retrieve a drive by ID: its type, owner and root folder ID',
			properties: [storageIdProperty],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'disk.storage.get', { id: readId(this, 'storageId', itemIndex, 'Storage ID') }, { itemIndex });
				return withoutLink(body.result);
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many drives',
			description: 'List the drives the webhook user can read, 50 per request. An administrator sees every user\'s drive.',
			properties: [
				...returnAllProperties('drives'),
				{
					displayName: 'Filters',
					name: 'filters',
					type: 'collection',
					placeholder: 'Add Filter',
					default: {},
					options: [
						{ displayName: 'Name Contains', name: 'nameContains', type: 'string', default: '' },
						{ displayName: 'Owner ID', name: 'ownerId', type: 'string', default: '', description: 'ID of the user or workgroup that owns the drive' },
						{
							displayName: 'Type',
							name: 'type',
							type: 'options',
							default: 'user',
							options: [
								{ name: 'Company', value: 'common' },
								{ name: 'User', value: 'user' },
								{ name: 'Workgroup', value: 'group' },
							],
						},
					],
				},
				filterJsonProperty('{"ENTITY_TYPE": "group", "ENTITY_ID": ["12", "15"]}'),
				orderJsonProperty('{"NAME": "ASC"}'),
			],
			async execute(itemIndex) {
				const f = (this.getNodeParameter('filters', itemIndex, {}) ?? {}) as IDataObject;
				const filter = { ...compact({ ENTITY_TYPE: f.type, ENTITY_ID: f.ownerId, '%NAME': f.nameContains }), ...jsonObject(this, 'filterJson', itemIndex) };
				const params: IDataObject = { filter };
				const order = jsonObject(this, 'orderJson', itemIndex);
				if (Object.keys(order).length > 0) params.order = order;
				return withoutLinks(await offsetRows(this, 'disk.storage.getList', params, { itemIndex, limit: limitOf(this, itemIndex) }));
			},
		},
		{
			value: 'getRootItems',
			name: 'Get Root Items',
			action: 'Get the files and folders at the root of a drive',
			description: 'List the files and folders directly at the root of a drive that the webhook user can read',
			properties: [
				storageIdProperty,
				...returnAllProperties('files and folders'),
				filterJsonProperty('{"TYPE": "file", "%NAME": "report"}'),
				orderJsonProperty('{"UPDATE_TIME": "DESC"}'),
			],
			async execute(itemIndex) {
				const params: IDataObject = { id: readId(this, 'storageId', itemIndex, 'Storage ID') };
				const filter = jsonObject(this, 'filterJson', itemIndex);
				const order = jsonObject(this, 'orderJson', itemIndex);
				if (Object.keys(filter).length > 0) params.filter = filter;
				if (Object.keys(order).length > 0) params.order = order;
				return withoutLinks(await offsetRows(this, 'disk.storage.getChildren', params, { itemIndex, limit: limitOf(this, itemIndex) }));
			},
		},
		{
			value: 'getFields',
			name: 'Get Fields',
			action: 'Get the fields of drives',
			description: 'Describe the fields of a drive: type, and whether a filter can use it',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'disk.storage.getFields', {}, { itemIndex });
				return fieldRows(body.result);
			},
		},
	],
};
