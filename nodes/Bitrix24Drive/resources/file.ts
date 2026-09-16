import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { numberProperty, positiveInt } from '../../../shared/props';
import { returnAllProperties } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { optionalInt } from '../../../shared/values';
import { binaryAsBase64 } from '../../Bitrix24Messenger/shared/helpers';
import {
	downloadExecutor,
	fieldRows,
	fileIdProperty,
	filterJsonProperty,
	folderIdProperty,
	inputBinaryProperty,
	jsonObject,
	limitOf,
	objectResult,
	offsetRows,
	outputBinaryProperty,
	readId,
	readRights,
	rightsProperty,
	storageIdProperty,
	targetFolderIdProperty,
	withoutLink,
	withoutLinks,
} from '../shared/helpers';

const toFolder = { show: { uploadTo: ['folder'] } };
const toStorage = { show: { uploadTo: ['storage'] } };
const versionIdProperty = numberProperty('Version ID', 'versionId', 'ID of a file version, as Get Versions returns it');

/** disk.file.search refuses a start above 1000: with 50 per page, 1050 results are the most it gives. */
const SEARCH_MAX_START = 1000;

function fileId(ctx: IExecuteFunctions, itemIndex: number): number {
	return readId(ctx, 'fileId', itemIndex, 'File ID');
}

async function readFile(ctx: IExecuteFunctions, itemIndex: number): Promise<{ id: number; meta: IDataObject }> {
	const id = fileId(ctx, itemIndex);
	const body = await bitrix24Request.call(ctx, 'disk.file.get', { id }, { itemIndex });
	return { id, meta: (body.result ?? {}) as IDataObject };
}

async function readVersion(ctx: IExecuteFunctions, itemIndex: number): Promise<{ id: number; meta: IDataObject }> {
	const id = positiveInt(ctx, 'versionId', itemIndex, 'Version ID');
	const body = await bitrix24Request.call(ctx, 'disk.version.get', { id }, { itemIndex });
	return { id, meta: (body.result ?? {}) as IDataObject };
}

export const fileResource: Resource = {
	value: 'file',
	name: 'File',
	description: 'Files on Drive: upload, download, search, versions, copy, move, trash and delete',
	operations: [
		{
			value: 'upload',
			name: 'Upload',
			action: 'Upload a file to Drive',
			description: 'Upload a file from the input binary data into a folder or to the root of a drive',
			properties: [
				{
					displayName: 'Upload To',
					name: 'uploadTo',
					type: 'options',
					default: 'folder',
					options: [
						{ name: 'Drive Root', value: 'storage', description: 'The root of a drive, picked by storage ID' },
						{ name: 'Folder', value: 'folder', description: 'A folder, the root folder of a drive included' },
					],
				},
				{ ...folderIdProperty, description: 'ID of the folder to upload into', displayOptions: toFolder },
				{ ...storageIdProperty, displayOptions: toStorage },
				inputBinaryProperty,
				{
					displayName: 'File Name',
					name: 'fileName',
					type: 'string',
					default: '',
					description: 'Name with extension. Leave empty to keep the name of the binary data.',
				},
				{
					displayName: 'If the Name Is Taken',
					name: 'onNameConflict',
					type: 'options',
					default: 'rename',
					options: [
						{ name: 'Add a Number', value: 'rename', description: 'Save as report (1).pdf, like Bitrix24 itself does' },
						{ name: 'Fail', value: 'fail', description: 'Stop with "A file with this name already exists"' },
					],
				},
				rightsProperty,
			],
			async execute(itemIndex) {
				const file = await binaryAsBase64(this, itemIndex, String(this.getNodeParameter('binaryProperty', itemIndex)));
				const name = String(this.getNodeParameter('fileName', itemIndex, '') ?? '').trim() || file.fileName;
				const toStorageRoot = String(this.getNodeParameter('uploadTo', itemIndex)) === 'storage';
				const params: IDataObject = {
					id: toStorageRoot ? readId(this, 'storageId', itemIndex, 'Storage ID') : readId(this, 'folderId', itemIndex, 'Folder ID'),
					data: { NAME: name },
					fileContent: [name, file.content],
					generateUniqueName: String(this.getNodeParameter('onNameConflict', itemIndex)) === 'rename',
				};
				const rights = readRights(this, itemIndex, 'rights.right');
				if (rights.length > 0) params.rights = rights;
				const body = await bitrix24Request.call(this, toStorageRoot ? 'disk.storage.uploadFile' : 'disk.folder.uploadFile', params, { itemIndex });
				return objectResult(this, body.result, 'save the file', itemIndex);
			},
		},
		{
			value: 'uploadVersion',
			name: 'Upload New Version',
			action: 'Upload a new version of a file',
			description: 'Replace the contents of a file with the input binary data. The file keeps its name and ID; keep your own copy if the old contents matter.',
			properties: [fileIdProperty, inputBinaryProperty],
			async execute(itemIndex) {
				const file = await binaryAsBase64(this, itemIndex, String(this.getNodeParameter('binaryProperty', itemIndex)));
				const body = await bitrix24Request.call(this, 'disk.file.uploadVersion', { id: fileId(this, itemIndex), fileContent: [file.fileName, file.content] }, { itemIndex });
				return objectResult(this, body.result, 'save the new version', itemIndex);
			},
		},
		{
			value: 'download',
			name: 'Download',
			action: 'Download a file from Drive',
			description: 'Download a file into binary data, with its Drive fields next to it',
			properties: [fileIdProperty, outputBinaryProperty],
			executeAll: downloadExecutor(readFile),
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get a file',
			description: 'Retrieve a file by ID: name, size, drive, folder, dates and a link to open it in Bitrix24',
			properties: [fileIdProperty],
			async execute(itemIndex) {
				return withoutLink((await readFile(this, itemIndex)).meta);
			},
		},
		{
			value: 'search',
			name: 'Search',
			action: 'Search files on Drive',
			description: 'Find files or folders by words in their names and in the text of documents, on every drive the webhook user can read or in one drive or folder',
			properties: [
				{
					displayName: 'Query',
					name: 'query',
					type: 'string',
					required: true,
					default: '',
					description: 'From 3 to 255 characters',
				},
				...returnAllProperties('files'),
				{
					displayName: 'Options',
					name: 'options',
					type: 'collection',
					placeholder: 'Add Option',
					default: {},
					options: [
						{ displayName: 'Folder ID', name: 'folderId', type: 'number', default: 0, description: 'Search only in this folder and the folders inside it' },
						{
							displayName: 'Look For',
							name: 'type',
							type: 'options',
							default: 'file',
							options: [
								{ name: 'Files', value: 'file' },
								{ name: 'Files and Folders', value: 'all' },
								{ name: 'Folders', value: 'folder' },
							],
						},
						{ displayName: 'Storage ID', name: 'storageId', type: 'number', default: 0, description: 'Search only on this drive' },
					],
				},
			],
			async execute(itemIndex) {
				const query = String(this.getNodeParameter('query', itemIndex)).trim().replace(/\s+/g, ' ');
				if (query.length < 3 || query.length > 255) {
					throw new NodeOperationError(this.getNode(), 'Query must be from 3 to 255 characters', { itemIndex });
				}
				const o = (this.getNodeParameter('options', itemIndex, {}) ?? {}) as IDataObject;
				const params: IDataObject = { QUERY: query, TYPE: o.type ?? 'file' };
				const filter: IDataObject = {};
				const storageId = optionalInt(o.storageId);
				const folderId = optionalInt(o.folderId);
				if (storageId !== undefined) filter.STORAGE_ID = storageId;
				if (folderId !== undefined) filter.FOLDER_ID = folderId;
				if (Object.keys(filter).length > 0) params.FILTER = filter;
				return withoutLinks(await offsetRows(this, 'disk.file.search', params, { itemIndex, limit: limitOf(this, itemIndex), maxStart: SEARCH_MAX_START }));
			},
		},
		{
			value: 'rename',
			name: 'Rename',
			action: 'Rename a file',
			description: 'Give a file a new name. Keep the extension: Bitrix24 warns that a name without it, or with a different one, breaks the file.',
			properties: [
				fileIdProperty,
				{ displayName: 'New Name', name: 'newName', type: 'string', required: true, default: '', placeholder: 'report-2026.pdf', description: 'The new name with the same extension' },
			],
			async execute(itemIndex) {
				const newName = String(this.getNodeParameter('newName', itemIndex)).trim();
				if (newName === '') throw new NodeOperationError(this.getNode(), 'New Name is empty', { itemIndex });
				const body = await bitrix24Request.call(this, 'disk.file.rename', { id: fileId(this, itemIndex), newName }, { itemIndex });
				return objectResult(this, body.result, 'rename the file', itemIndex);
			},
		},
		{
			value: 'copy',
			name: 'Copy',
			action: 'Copy a file',
			description: 'Copy a file into another folder, on any drive the webhook user can add to',
			properties: [fileIdProperty, targetFolderIdProperty],
			async execute(itemIndex) {
				const params = { id: fileId(this, itemIndex), targetFolderId: readId(this, 'targetFolderId', itemIndex, 'Target Folder ID') };
				const body = await bitrix24Request.call(this, 'disk.file.copyTo', params, { itemIndex });
				return objectResult(this, body.result, 'copy the file', itemIndex);
			},
		},
		{
			value: 'move',
			name: 'Move',
			action: 'Move a file',
			description: 'Move a file into another folder of the same drive. Bitrix24 does not move files between drives: copy and delete instead.',
			properties: [fileIdProperty, targetFolderIdProperty],
			async execute(itemIndex) {
				const params = { id: fileId(this, itemIndex), targetFolderId: readId(this, 'targetFolderId', itemIndex, 'Target Folder ID') };
				const body = await bitrix24Request.call(this, 'disk.file.moveTo', params, { itemIndex });
				return objectResult(this, body.result, 'move the file', itemIndex);
			},
		},
		{
			value: 'moveToTrash',
			name: 'Move to Trash',
			action: 'Move a file to the trash',
			description: 'Put a file into the Drive trash, from where Restore From Trash brings it back. Keep its ID: the trash cannot be listed through the API.',
			properties: [fileIdProperty],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'disk.file.markDeleted', { id: fileId(this, itemIndex) }, { itemIndex });
				return objectResult(this, body.result, 'move the file to the trash', itemIndex);
			},
		},
		{
			value: 'restore',
			name: 'Restore From Trash',
			action: 'Restore a file from the trash',
			description: 'Bring a file back from the Drive trash by its ID. If the name is taken by then, a number is added to it.',
			properties: [fileIdProperty],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'disk.file.restore', { id: fileId(this, itemIndex) }, { itemIndex });
				return objectResult(this, body.result, 'restore the file', itemIndex);
			},
		},
		{
			value: 'delete',
			name: 'Delete Permanently',
			action: 'Delete a file permanently',
			description: 'Delete a file without the trash. It cannot be restored.',
			properties: [fileIdProperty],
			async execute(itemIndex) {
				const id = fileId(this, itemIndex);
				await bitrix24Request.call(this, 'disk.file.delete', { id }, { itemIndex });
				return { fileId: id, deleted: true };
			},
		},
		{
			value: 'getPublicLink',
			name: 'Get Public Link',
			action: 'Get a public link to a file',
			description: 'Get a link that opens the file for anyone who has it, without signing in to Bitrix24',
			properties: [fileIdProperty],
			async execute(itemIndex) {
				const id = fileId(this, itemIndex);
				const body = await bitrix24Request.call(this, 'disk.file.getExternalLink', { id }, { itemIndex });
				return { fileId: id, publicLink: body.result ?? null };
			},
		},
		{
			value: 'getVersions',
			name: 'Get Versions',
			action: 'Get the versions of a file',
			description: 'List the versions Bitrix24 kept of a file, newest first. After uploads by the same user it may keep only the latest one.',
			properties: [fileIdProperty, ...returnAllProperties('versions'), filterJsonProperty('{"&gt;SIZE": 1048576}. Dates here are the webhook user\'s local time without an offset: {"&gt;=CREATE_TIME": "2026-09-01 00:00:00"}')],
			async execute(itemIndex) {
				const params: IDataObject = { id: fileId(this, itemIndex) };
				const filter = jsonObject(this, 'filterJson', itemIndex);
				if (Object.keys(filter).length > 0) params.filter = filter;
				return withoutLinks(await offsetRows(this, 'disk.file.getVersions', params, { itemIndex, limit: limitOf(this, itemIndex) }));
			},
		},
		{
			value: 'getVersion',
			name: 'Get Version',
			action: 'Get a file version',
			description: 'Retrieve one version of a file by its ID: size, author and date',
			properties: [versionIdProperty],
			async execute(itemIndex) {
				return withoutLink((await readVersion(this, itemIndex)).meta);
			},
		},
		{
			value: 'downloadVersion',
			name: 'Download Version',
			action: 'Download a file version',
			description: 'Download one version of a file into binary data',
			properties: [versionIdProperty, outputBinaryProperty],
			executeAll: downloadExecutor(readVersion),
		},
		{
			value: 'restoreVersion',
			name: 'Restore Version',
			action: 'Restore a file version',
			description: 'Make a saved version the current contents of the file',
			properties: [fileIdProperty, versionIdProperty],
			async execute(itemIndex) {
				const params = { id: fileId(this, itemIndex), versionId: positiveInt(this, 'versionId', itemIndex, 'Version ID') };
				const body = await bitrix24Request.call(this, 'disk.file.restoreFromVersion', params, { itemIndex });
				return objectResult(this, body.result, 'restore the version', itemIndex);
			},
		},
		{
			value: 'getFields',
			name: 'Get Fields',
			action: 'Get the fields of files',
			description: 'Describe the fields of a file: type, and whether a filter can use it',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'disk.file.getFields', {}, { itemIndex });
				return fieldRows(body.result);
			},
		},
	],
};
