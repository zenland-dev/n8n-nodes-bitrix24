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
import { attachedFileResource } from './resources/attachedFile';
import { fileResource } from './resources/file';
import { folderResource } from './resources/folder';
import { storageResource } from './resources/storage';

const resources: Resource[] = [fileResource, folderResource, storageResource, attachedFileResource];

export class Bitrix24Drive implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitrix24 Drive',
		name: 'bitrix24Drive',
		icon: {
			light: 'file:../../icons/bitrix24.svg',
			dark: 'file:../../icons/bitrix24.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Upload, download, find and organize files and folders on Bitrix24 Drive',
		defaults: { name: 'Bitrix24 Drive' },
		usableAsTool: true,
		builderHint: {
			searchHint:
				'Bitrix24 Drive as the user who owns the webhook: personal drives, workgroup drives and the company drive. A file is put into a folder by folder ID; the root folder of a drive is ROOT_OBJECT_ID from Storage → Get by Owner. File → Upload takes binary data, File → Download returns it. Download links Bitrix24 gives carry a secret, so outputs never contain them; File → Get Public Link makes a link to share. Move works within one drive only; Copy works across drives. Move to Trash is reversible by ID, Delete Permanently is not. Search needs at least 3 characters and also reads the text of documents. About 2 requests per second per portal.',
			relatedNodes: [
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24Messenger',
					relationHint: 'Sends Drive files into chats and saves chat files to Drive',
				},
				{
					nodeType: '@zenland-dev/n8n-nodes-bitrix24.bitrix24Tasks',
					relationHint: 'Attaches Drive files to tasks',
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
		properties: buildProperties(resources, 'file'),
	};

	methods = { loadOptions };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await executeResources.call(this, resources);
	}
}
