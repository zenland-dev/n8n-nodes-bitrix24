import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/**
 * A business process always runs on a document — a CRM record, a list element, a Drive
 * file — and Bitrix24 names one with three strings: the module, a PHP class and an ID.
 * The class names are not guessable (Bitrix\Crm\Integration\BizProc\Document\Quote),
 * so the node keeps them here and asks for the kind and the ID instead.
 */
interface DocumentKind {
	value: string;
	name: string;
	description: string;
	module: string;
	entity: string;
	/** What stands in front of the record ID: DEAL_777. Empty means a bare ID. */
	prefix: string;
	/** The container whose ID belongs in the document type: DYNAMIC_147, iblock_42, STORAGE_3. */
	container?: 'spa' | 'iblock' | 'storage';
}

/** Kept in the order n8n shows them, which its linter wants alphabetical. */
const DOCUMENT_KINDS: DocumentKind[] = [
	{
		value: 'company',
		name: 'Company',
		description: 'A company of the CRM',
		module: 'crm',
		entity: 'CCrmDocumentCompany',
		prefix: 'COMPANY',
	},
	{
		value: 'contact',
		name: 'Contact',
		description: 'A contact of the CRM',
		module: 'crm',
		entity: 'CCrmDocumentContact',
		prefix: 'CONTACT',
	},
	{
		value: 'deal',
		name: 'Deal',
		description: 'A deal of the CRM',
		module: 'crm',
		entity: 'CCrmDocumentDeal',
		prefix: 'DEAL',
	},
	{
		value: 'driveFile',
		name: 'Drive File',
		description: 'A file on the Drive; the document type carries the storage it lives in',
		module: 'disk',
		entity: 'Bitrix\\Disk\\BizProcDocument',
		prefix: '',
		container: 'storage',
	},
	{
		value: 'invoice',
		name: 'Invoice',
		description: 'An invoice of the CRM, the smart-process kind',
		module: 'crm',
		entity: 'Bitrix\\Crm\\Integration\\BizProc\\Document\\SmartInvoice',
		prefix: 'SMART_INVOICE',
	},
	{
		value: 'lead',
		name: 'Lead',
		description: 'A lead of the CRM',
		module: 'crm',
		entity: 'CCrmDocumentLead',
		prefix: 'LEAD',
	},
	{
		value: 'listElement',
		name: 'List Element',
		description: 'An element of a list in a workgroup',
		module: 'lists',
		entity: 'Bitrix\\Lists\\BizprocDocumentLists',
		prefix: '',
		container: 'iblock',
	},
	{
		value: 'feedElement',
		name: 'News Feed Process',
		description: 'An element of a process list in the news feed',
		module: 'lists',
		entity: 'BizprocDocument',
		prefix: '',
		container: 'iblock',
	},
	{
		value: 'quote',
		name: 'Quote',
		description: 'An estimate of the CRM',
		module: 'crm',
		entity: 'Bitrix\\Crm\\Integration\\BizProc\\Document\\Quote',
		prefix: 'QUOTE',
	},
	{
		value: 'spaItem',
		name: 'Smart Process Item',
		description: 'An item of a smart process; the document type carries the process ID',
		module: 'crm',
		entity: 'Bitrix\\Crm\\Integration\\BizProc\\Document\\Dynamic',
		prefix: 'DYNAMIC',
		container: 'spa',
	},
];

const WITH_CONTAINER = DOCUMENT_KINDS.filter((kind) => kind.container !== undefined).map((kind) => kind.value);

export const documentKindProperty: INodeProperties = {
	displayName: 'Document Type',
	name: 'documentKind',
	type: 'options',
	default: 'deal',
	description: 'What the business process runs on',
	options: DOCUMENT_KINDS.map((kind) => ({ name: kind.name, value: kind.value, description: kind.description })),
};

export const containerIdProperty: INodeProperties = {
	displayName: 'Container ID',
	name: 'containerId',
	type: 'number',
	default: 0,
	displayOptions: { show: { documentKind: WITH_CONTAINER } },
	description:
		'ID of the smart process, the list or the Drive storage the record belongs to. Bitrix24 spells the document type out of it: DYNAMIC_147, iblock_42, STORAGE_3.',
};

export function documentIdProperty(description: string): INodeProperties {
	return {
		displayName: 'Record ID',
		name: 'documentId',
		type: 'number',
		default: 0,
		required: true,
		description,
	};
}

function kindOf(ctx: IExecuteFunctions, itemIndex: number): DocumentKind {
	const value = String(ctx.getNodeParameter('documentKind', itemIndex, 'deal'));
	const kind = DOCUMENT_KINDS.find((candidate) => candidate.value === value);
	if (kind === undefined) {
		throw new NodeOperationError(ctx.getNode(), `Unknown document type "${value}"`, { itemIndex });
	}
	return kind;
}

function containerOf(ctx: IExecuteFunctions, kind: DocumentKind, itemIndex: number): number {
	if (kind.container === undefined) return 0;

	const id = Number(ctx.getNodeParameter('containerId', itemIndex, 0));
	if (!Number.isInteger(id) || id <= 0) {
		const what =
			kind.container === 'spa'
				? 'the smart process'
				: kind.container === 'iblock'
					? 'the list'
					: 'the Drive storage';
		throw new NodeOperationError(ctx.getNode(), `Container ID is required for ${kind.name}`, {
			itemIndex,
			description: `Bitrix24 puts the ID of ${what} into the document type, so the process cannot be addressed without it.`,
		});
	}
	return id;
}

/** The third string of DOCUMENT_TYPE: DEAL, DYNAMIC_147, iblock_42, STORAGE_3. */
function typeToken(kind: DocumentKind, containerId: number): string {
	switch (kind.container) {
		case 'spa':
			return `${kind.prefix}_${containerId}`;
		case 'iblock':
			return `iblock_${containerId}`;
		case 'storage':
			return `STORAGE_${containerId}`;
		default:
			return kind.prefix;
	}
}

/** ['crm', 'CCrmDocumentDeal', 'DEAL'] — which objects a template belongs to. */
export function documentType(ctx: IExecuteFunctions, itemIndex: number): [string, string, string] {
	const kind = kindOf(ctx, itemIndex);
	return [kind.module, kind.entity, typeToken(kind, containerOf(ctx, kind, itemIndex))];
}

/** ['crm', 'CCrmDocumentDeal', 'DEAL_777'] — the record a process runs on. */
export function documentIdOf(ctx: IExecuteFunctions, itemIndex: number): [string, string, string] {
	const kind = kindOf(ctx, itemIndex);
	const containerId = containerOf(ctx, kind, itemIndex);
	const id = Number(ctx.getNodeParameter('documentId', itemIndex, 0));

	if (!Number.isInteger(id) || id <= 0) {
		throw new NodeOperationError(ctx.getNode(), 'Record ID must be a positive whole number', { itemIndex });
	}

	// A smart process item is spelled DYNAMIC_<process>_<item>; a list element and a Drive
	// file carry no prefix at all, only the plain ID.
	const token =
		kind.container === 'spa'
			? `${kind.prefix}_${containerId}_${id}`
			: kind.prefix === ''
				? String(id)
				: `${kind.prefix}_${id}`;

	return [kind.module, kind.entity, token];
}

/** Splits DEAL_777 back into the parts the output shows next to the raw value. */
export function describeDocument(value: unknown): IDataObject {
	const text = String(value ?? '');
	const match = text.match(/^([A-Z_]+?)_(\d+)$/);
	return match === null
		? { documentId: text }
		: { documentId: text, entityType: match[1], entityId: Number(match[2]) };
}
