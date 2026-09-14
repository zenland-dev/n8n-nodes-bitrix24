import type { IDataObject } from 'n8n-workflow';

import { crudOperations } from '../../../shared/crud';
import { compact, jsonParameter } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { entityTypeProperty, jsonProperty, numberProperty, positiveInt, rows } from '../shared/props';

const documentId = numberProperty('Document ID', 'documentId', 'ID of the generated document');

export const documentResource: Resource = {
	value: 'document',
	name: 'Document',
	description: 'Documents generated from templates for CRM records — contracts, invoices, acts',
	operations: [
		{
			value: 'generate',
			name: 'Generate',
			action: 'Generate a document from a template',
			description: 'Fill a document template with the data of a record and store the result on the record; PDF and image links appear a few seconds later',
			properties: [
				numberProperty('Template ID', 'templateId', 'ID of the document template'),
				entityTypeProperty('Type of the record the document is for'),
				numberProperty('Record ID', 'entityId', 'ID of that record'),
				jsonProperty('Values (JSON)', 'values', 'Overrides for template placeholders, e.g. {"DocumentNumber": "2026-117"}'),
				{ displayName: 'Stamps and Signatures', name: 'stampsEnabled', type: 'boolean', default: false, description: 'Whether to put the company stamp and signatures in' },
			],
			async execute(itemIndex) {
				const params: IDataObject = {
					templateId: positiveInt(this, 'templateId', itemIndex, 'Template ID'),
					entityTypeId: positiveInt(this, 'entityTypeId', itemIndex, 'Entity type'),
					entityId: positiveInt(this, 'entityId', itemIndex, 'Record ID'),
					stampsEnabled: (this.getNodeParameter('stampsEnabled', itemIndex) as boolean) ? 1 : 0,
				};
				const values = jsonParameter<IDataObject>(this, 'values', itemIndex, {});
				if (Object.keys(values).length > 0) params.values = values;
				const body = await bitrix24Request.call(this, 'crm.documentgenerator.document.add', params, { itemIndex });
				return rows(body.result, 'document');
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get a document',
			description: 'Retrieve a generated document with its download, PDF and image links',
			properties: [documentId],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.documentgenerator.document.get', { id: positiveInt(this, 'documentId', itemIndex, 'Document ID') }, { itemIndex });
				return rows(body.result, 'document');
			},
		},
		...crudOperations({
			prefix: 'crm.documentgenerator.document',
			noun: 'document',
			plural: 'documents',
			kinds: ['getMany', 'delete'],
			listIdField: 'id',
			fieldsExample: '{}',
			descriptions: { getMany: 'List generated documents; filter by record with {"entityTypeId": 2, "entityId": 15}' },
		}),
		{
			value: 'update',
			name: 'Update',
			action: 'Regenerate a document',
			description: 'Regenerate a document with changed placeholder values',
			properties: [
				documentId,
				jsonProperty('Values (JSON)', 'values', 'Placeholder values to change, e.g. {"DocumentNumber": "2026-118"}'),
				{ displayName: 'Stamps and Signatures', name: 'stampsEnabled', type: 'boolean', default: true, description: 'Whether to put the company stamp and signatures in' },
			],
			async execute(itemIndex) {
				const params = {
					id: positiveInt(this, 'documentId', itemIndex, 'Document ID'),
					values: jsonParameter<IDataObject>(this, 'values', itemIndex, {}),
					stampsEnabled: (this.getNodeParameter('stampsEnabled', itemIndex) as boolean) ? 1 : 0,
				};
				const body = await bitrix24Request.call(this, 'crm.documentgenerator.document.update', params, { itemIndex });
				return rows(body.result, 'document');
			},
		},
		{
			value: 'setPublicLink',
			name: 'Set Public Link',
			action: 'Turn the public link of a document on or off',
			description: 'Create or revoke a link that opens the document without logging in — for sending to a client',
			properties: [
				documentId,
				{ displayName: 'Enabled', name: 'publicEnabled', type: 'boolean', default: true, description: 'Whether the public link works' },
			],
			async execute(itemIndex) {
				const params = { id: positiveInt(this, 'documentId', itemIndex, 'Document ID'), status: (this.getNodeParameter('publicEnabled', itemIndex) as boolean) ? 1 : 0 };
				const body = await bitrix24Request.call(this, 'crm.documentgenerator.document.enablepublicurl', params, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'getFields',
			name: 'Get Placeholders',
			action: 'Get the placeholders of a document',
			description: 'List the placeholders of a document with the values they currently resolve to',
			properties: [documentId],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'crm.documentgenerator.document.getfields', { id: positiveInt(this, 'documentId', itemIndex, 'Document ID') }, { itemIndex });
				return rows(body.result, 'documentFields');
			},
		},
		{
			value: 'upload',
			name: 'Upload',
			action: 'Attach a ready document to a record',
			description: 'Store a document made elsewhere on a record, as DOCX with optional PDF and image copies',
			properties: [
				entityTypeProperty('Type of the record'),
				numberProperty('Record ID', 'entityId', 'ID of that record'),
				{ displayName: 'Title', name: 'title', type: 'string', required: true, default: '' },
				{ displayName: 'Number', name: 'number', type: 'string', required: true, default: '' },
				{ displayName: 'Region', name: 'region', type: 'string', required: true, default: 'ru', description: 'Template region code, e.g. ru, de, us' },
				{ displayName: 'DOCX (Base64)', name: 'fileContent', type: 'string', required: true, default: '' },
				{
					displayName: 'Additional Fields',
					name: 'uploadOptions',
					type: 'collection',
					placeholder: 'Add Field',
					default: {},
					options: [
						{ displayName: 'Image (Base64)', name: 'imageContent', type: 'string', default: '' },
						{ displayName: 'PDF (Base64)', name: 'pdfContent', type: 'string', default: '' },
					],
				},
			],
			async execute(itemIndex) {
				const o = (this.getNodeParameter('uploadOptions', itemIndex, {}) ?? {}) as IDataObject;
				const fields = compact({
					entityTypeId: positiveInt(this, 'entityTypeId', itemIndex, 'Entity type'),
					entityId: positiveInt(this, 'entityId', itemIndex, 'Record ID'),
					title: this.getNodeParameter('title', itemIndex) as string,
					number: this.getNodeParameter('number', itemIndex) as string,
					region: this.getNodeParameter('region', itemIndex) as string,
					fileContent: this.getNodeParameter('fileContent', itemIndex) as string,
					pdfContent: o.pdfContent,
					imageContent: o.imageContent,
				});
				const body = await bitrix24Request.call(this, 'crm.documentgenerator.document.upload', { fields }, { itemIndex });
				return rows(body.result, 'document');
			},
		},
	],
};

export const documentTemplateResource: Resource = {
	value: 'documentTemplate',
	name: 'Document Template',
	description: 'DOCX templates documents are generated from',
	operations: crudOperations({
		prefix: 'crm.documentgenerator.template',
		noun: 'document template',
		plural: 'document templates',
		kinds: ['create', 'get', 'getMany', 'update', 'delete'],
		resultKey: 'template',
		listIdField: 'id',
		fieldsExample: '{"name": "Contract", "file": ["contract.docx", "&lt;base64&gt;"], "numeratorId": 1, "region": "ru", "entityTypeId": ["2"]}',
		descriptions: { create: 'Upload a DOCX template and choose which CRM types it serves, e.g. "2_category_0" for deals of pipeline 0' },
	}),
};

export const documentNumeratorResource: Resource = {
	value: 'documentNumerator',
	name: 'Document Numerator',
	description: 'Number sequences generated documents take their numbers from',
	operations: crudOperations({
		prefix: 'crm.documentgenerator.numerator',
		noun: 'numerator',
		plural: 'numerators',
		kinds: ['create', 'get', 'getMany', 'update', 'delete'],
		resultKey: 'numerator',
		listKey: 'numerators',
		listParams: [],
		fieldsExample: '{"name": "Contracts", "template": "C-{NUMBER}", "settings": {"Bitrix_Main_Numerator_Generator_SequentNumberGenerator": {"start": 1, "step": 1}}}',
	}),
};
