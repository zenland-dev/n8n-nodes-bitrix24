import type { IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { compact, returnAllProperties } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import {
	driveFilterDate,
	fieldRows,
	filterJsonProperty,
	folderIdProperty,
	jsonObject,
	limitOf,
	objectResult,
	offsetRows,
	orderJsonProperty,
	readId,
	readRights,
	rightsProperty,
	storageIdProperty,
	targetFolderIdProperty,
	withoutLink,
	withoutLinks,
} from '../shared/helpers';

const folderOnly = { show: { createIn: ['folder'] } };
const storageOnly = { show: { createIn: ['storage'] } };

function folderId(ctx: Parameters<typeof readId>[0], itemIndex: number): number {
	return readId(ctx, 'folderId', itemIndex, 'Folder ID');
}

export const folderResource: Resource = {
	value: 'folder',
	name: 'Folder',
	description: 'Folders on Drive: create, list, copy, move, share, trash and delete',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Create a folder',
			description: 'Create a folder inside another folder or at the root of a drive',
			properties: [
				{
					displayName: 'Create In',
					name: 'createIn',
					type: 'options',
					default: 'folder',
					options: [
						{ name: 'Drive Root', value: 'storage', description: 'At the root of a drive, picked by storage ID' },
						{ name: 'Folder', value: 'folder', description: 'Inside a folder, the root folder of a drive included' },
					],
				},
				{ ...folderIdProperty, displayName: 'Parent Folder ID', description: 'ID of the folder to create the new one in', displayOptions: folderOnly },
				{ ...storageIdProperty, displayOptions: storageOnly },
				{ displayName: 'Folder Name', name: 'folderName', type: 'string', required: true, default: '', description: 'A folder with this name must not exist there yet' },
				rightsProperty,
			],
			async execute(itemIndex) {
				const name = String(this.getNodeParameter('folderName', itemIndex)).trim();
				if (name === '') throw new NodeOperationError(this.getNode(), 'Folder Name is empty', { itemIndex });
				const inStorage = String(this.getNodeParameter('createIn', itemIndex)) === 'storage';
				const params: IDataObject = {
					id: inStorage ? readId(this, 'storageId', itemIndex, 'Storage ID') : folderId(this, itemIndex),
					data: { NAME: name },
				};
				const rights = readRights(this, itemIndex, 'rights.right');
				if (rights.length > 0) params.rights = rights;
				const body = await bitrix24Request.call(this, inStorage ? 'disk.storage.addFolder' : 'disk.folder.addSubFolder', params, { itemIndex });
				return objectResult(this, body.result, 'create the folder', itemIndex);
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get a folder',
			description: 'Retrieve a folder by ID: name, drive, parent folder, dates and a link to open it in Bitrix24',
			properties: [folderIdProperty],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'disk.folder.get', { id: folderId(this, itemIndex) }, { itemIndex });
				return withoutLink(body.result);
			},
		},
		{
			value: 'getItems',
			name: 'Get Items',
			action: 'Get the files and folders in a folder',
			description: 'List the files and folders directly inside a folder that the webhook user can read, 50 per request',
			properties: [
				folderIdProperty,
				...returnAllProperties('files and folders'),
				{
					displayName: 'Filters',
					name: 'filters',
					type: 'collection',
					placeholder: 'Add Filter',
					default: {},
					options: [
						{ displayName: 'Name Contains', name: 'nameContains', type: 'string', default: '' },
						{
							displayName: 'Type',
							name: 'type',
							type: 'options',
							default: 'file',
							options: [
								{ name: 'File', value: 'file' },
								{ name: 'Folder', value: 'folder' },
							],
						},
						{ displayName: 'Updated After', name: 'updatedAfter', type: 'dateTime', default: '' },
					],
				},
				filterJsonProperty('{"%NAME": "invoice"}. Only fields that Get Fields of folders marks USE_IN_FILTER work (ID, NAME, TYPE, CODE, PARENT_ID, the dates); others such as SIZE or CREATED_BY are ignored. Dates are the webhook user\'s local time without an offset: {"&lt;UPDATE_TIME": "2026-09-01 00:00:00"}'),
				orderJsonProperty('{"UPDATE_TIME": "DESC"}'),
			],
			async execute(itemIndex) {
				const f = (this.getNodeParameter('filters', itemIndex, {}) ?? {}) as IDataObject;
				const updatedAfter = await driveFilterDate(this, f.updatedAfter, itemIndex);
				const filter = { ...compact({ TYPE: f.type, '%NAME': f.nameContains, '>UPDATE_TIME': updatedAfter }), ...jsonObject(this, 'filterJson', itemIndex) };
				const params: IDataObject = { id: folderId(this, itemIndex) };
				if (Object.keys(filter).length > 0) params.filter = filter;
				const order = jsonObject(this, 'orderJson', itemIndex);
				if (Object.keys(order).length > 0) params.order = order;
				return withoutLinks(await offsetRows(this, 'disk.folder.getChildren', params, { itemIndex, limit: limitOf(this, itemIndex) }));
			},
		},
		{
			value: 'rename',
			name: 'Rename',
			action: 'Rename a folder',
			description: 'Give a folder a new name',
			properties: [folderIdProperty, { displayName: 'New Name', name: 'newName', type: 'string', required: true, default: '' }],
			async execute(itemIndex) {
				const newName = String(this.getNodeParameter('newName', itemIndex)).trim();
				if (newName === '') throw new NodeOperationError(this.getNode(), 'New Name is empty', { itemIndex });
				const body = await bitrix24Request.call(this, 'disk.folder.rename', { id: folderId(this, itemIndex), newName }, { itemIndex });
				return objectResult(this, body.result, 'rename the folder', itemIndex);
			},
		},
		{
			value: 'copy',
			name: 'Copy',
			action: 'Copy a folder',
			description: 'Copy a folder with everything in it into another folder, on any drive the webhook user can add to',
			properties: [folderIdProperty, targetFolderIdProperty],
			async execute(itemIndex) {
				const params = { id: folderId(this, itemIndex), targetFolderId: readId(this, 'targetFolderId', itemIndex, 'Target Folder ID') };
				const body = await bitrix24Request.call(this, 'disk.folder.copyTo', params, { itemIndex });
				return objectResult(this, body.result, 'copy the folder', itemIndex);
			},
		},
		{
			value: 'move',
			name: 'Move',
			action: 'Move a folder',
			description: 'Move a folder with everything in it into another folder of the same drive',
			properties: [folderIdProperty, targetFolderIdProperty],
			async execute(itemIndex) {
				const params = { id: folderId(this, itemIndex), targetFolderId: readId(this, 'targetFolderId', itemIndex, 'Target Folder ID') };
				const body = await bitrix24Request.call(this, 'disk.folder.moveTo', params, { itemIndex });
				return objectResult(this, body.result, 'move the folder', itemIndex);
			},
		},
		{
			value: 'moveToTrash',
			name: 'Move to Trash',
			action: 'Move a folder to the trash',
			description: 'Put a folder into the Drive trash, from where Restore From Trash brings it back. Keep its ID: the trash cannot be listed through the API.',
			properties: [folderIdProperty],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'disk.folder.markDeleted', { id: folderId(this, itemIndex) }, { itemIndex });
				return objectResult(this, body.result, 'move the folder to the trash', itemIndex);
			},
		},
		{
			value: 'restore',
			name: 'Restore From Trash',
			action: 'Restore a folder from the trash',
			description: 'Bring a folder back from the Drive trash by its ID. Bitrix24 allows this to administrators only.',
			properties: [folderIdProperty],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'disk.folder.restore', { id: folderId(this, itemIndex) }, { itemIndex });
				return objectResult(this, body.result, 'restore the folder', itemIndex);
			},
		},
		{
			value: 'delete',
			name: 'Delete Permanently',
			action: 'Delete a folder permanently',
			description: 'Delete a folder and everything in it without the trash. It cannot be restored.',
			properties: [folderIdProperty],
			async execute(itemIndex) {
				const id = folderId(this, itemIndex);
				await bitrix24Request.call(this, 'disk.folder.deleteTree', { id }, { itemIndex });
				return { folderId: id, deleted: true };
			},
		},
		{
			value: 'share',
			name: 'Share With User',
			action: 'Share a folder with a user',
			description: 'Give a user access to a folder. The webhook user cannot grant more than it has itself.',
			properties: [
				folderIdProperty,
				{ displayName: 'User ID', name: 'userId', type: 'number', required: true, default: 0, description: 'ID of the user who gets access' },
				{
					displayName: 'Access Level',
					name: 'accessLevel',
					type: 'options',
					default: 'disk_access_read',
					options: [
						{ name: 'Add', value: 'disk_access_add', description: 'Read and add files' },
						{ name: 'Edit', value: 'disk_access_edit', description: 'Read, add and change files' },
						{ name: 'Full Access', value: 'disk_access_full', description: 'Everything, deleting and sharing included' },
						{ name: 'Read', value: 'disk_access_read', description: 'Open and download' },
					],
				},
			],
			async execute(itemIndex) {
				const params = { id: folderId(this, itemIndex), userId: readId(this, 'userId', itemIndex, 'User ID'), taskName: String(this.getNodeParameter('accessLevel', itemIndex)) };
				const body = await bitrix24Request.call(this, 'disk.folder.shareToUser', params, { itemIndex });
				return { folderId: params.id, userId: params.userId, accessLevel: params.taskName, shared: body.result === true };
			},
		},
		{
			value: 'getPublicLink',
			name: 'Get Public Link',
			action: 'Get a public link to a folder',
			description: 'Get a link that opens the folder for anyone who has it, without signing in to Bitrix24',
			properties: [folderIdProperty],
			async execute(itemIndex) {
				const id = folderId(this, itemIndex);
				const body = await bitrix24Request.call(this, 'disk.folder.getExternalLink', { id }, { itemIndex });
				return { folderId: id, publicLink: body.result ?? null };
			},
		},
		{
			value: 'getFields',
			name: 'Get Fields',
			action: 'Get the fields of folders',
			description: 'Describe the fields of a folder: type, and whether a filter can use it',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'disk.folder.getFields', {}, { itemIndex });
				return fieldRows(body.result);
			},
		},
	],
};
