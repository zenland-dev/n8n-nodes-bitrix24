import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { listAll } from './list';
import { jsonParameter, returnAllProperties, stringList } from './params';
import type { Operation } from './spec';
import { bitrix24Request } from './transport';

/**
 * Operations for the many Bitrix24 objects that follow one pattern:
 * `<prefix>.add {fields}`, `.get {id}`, `.list {select, filter, order, start}`,
 * `.update {id, fields}`, `.delete {id}`, `.fields`. Their fields go in as JSON —
 * the objects are administrative (requisite presets, currencies, numerators) and
 * their field lists come from `Get Fields`, so a generated form would add little.
 */
export type CrudKind = 'create' | 'get' | 'getMany' | 'update' | 'delete' | 'getFields';

export interface CrudConfig {
	/** Method prefix, e.g. crm.requisite, or a function of the item's parameters. */
	prefix: string | ((ctx: IExecuteFunctions, itemIndex: number) => string);
	noun: string;
	plural: string;
	kinds?: CrudKind[];
	/** Method suffix per kind when it is not the usual add/get/list/update/delete/fields. */
	methods?: Partial<Record<CrudKind, string>>;
	/** Name of the ID key in get/update/delete calls. */
	idKey?: string;
	/** A different ID key for one kind — crm.currency.update wants ID where get and delete want id. */
	idKeys?: Partial<Record<CrudKind, string>>;
	/** Parameters shown on every operation, e.g. the entity type a pipeline belongs to. */
	context?: INodeProperties[];
	/** Reads `context` into call parameters. */
	contextParams?: (ctx: IExecuteFunctions, itemIndex: number) => IDataObject;
	/** Where the object sits inside `result` of add/get/update, if wrapped. */
	resultKey?: string;
	/** Where rows sit inside `result` of list. */
	listKey?: string;
	/** ID field for keyset paging; omit for methods that do not page or ignore order. */
	listIdField?: string;
	/** Which list parameters the method accepts. */
	listParams?: Array<'select' | 'filter' | 'order'>;
	/** Example of `fields` JSON shown in the description. */
	fieldsExample: string;
	/** Whether IDs are numbers or codes such as currency EUR. */
	idType?: 'number' | 'string';
	/** Smallest valid numeric ID. The default pipeline of deals, for one, is 0. */
	minId?: number;
	/** Name of the parameter the fields go in — userfieldconfig takes `field`, most take `fields`. */
	fieldsKey?: string;
	descriptions?: Partial<Record<CrudKind, string>>;
}

const DEFAULT_METHODS: Record<CrudKind, string> = {
	create: 'add',
	get: 'get',
	getMany: 'list',
	update: 'update',
	delete: 'delete',
	getFields: 'fields',
};

function unwrap(result: unknown, key?: string): IDataObject | IDataObject[] {
	let value = result;
	if (key !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)) {
		value = (value as IDataObject)[key] ?? value;
	}
	if (Array.isArray(value)) {
		return value.map((v) => (v !== null && typeof v === 'object' ? (v as IDataObject) : { value: v as string }));
	}
	if (value !== null && typeof value === 'object') return value as IDataObject;
	return { result: value as string };
}

function capital(text: string): string {
	return `${text[0].toUpperCase()}${text.slice(1)}`;
}

export function crudOperations(config: CrudConfig): Operation[] {
	const kinds = config.kinds ?? ['create', 'get', 'getMany', 'update', 'delete', 'getFields'];
	const idKeyOf = (kind: CrudKind): string => config.idKeys?.[kind] ?? config.idKey ?? 'id';
	const fieldsKey = config.fieldsKey ?? 'fields';
	const context = config.context ?? [];
	const prefix = config.prefix;
	const suffix = (kind: CrudKind): string => config.methods?.[kind] ?? DEFAULT_METHODS[kind];
	const methodOf = (ctx: IExecuteFunctions, itemIndex: number, kind: CrudKind): string =>
		`${typeof prefix === 'string' ? prefix : prefix(ctx, itemIndex)}.${suffix(kind)}`;
	const contextOf = (ctx: IExecuteFunctions, itemIndex: number): IDataObject =>
		config.contextParams?.(ctx, itemIndex) ?? {};

	const idProperty: INodeProperties = {
		displayName: `${capital(config.noun)} ID`,
		name: 'objectId',
		type: config.idType === 'string' ? 'string' : 'number',
		required: true,
		default: config.idType === 'string' ? '' : 0,
		description: `ID of the ${config.noun}`,
	};
	const readId = (ctx: IExecuteFunctions, itemIndex: number): number | string => {
		const raw = ctx.getNodeParameter('objectId', itemIndex);
		if (config.idType === 'string') {
			const text = String(raw ?? '').trim();
			if (text === '') throw new NodeOperationError(ctx.getNode(), `${capital(config.noun)} ID is required`, { itemIndex });
			return text;
		}
		const id = Number(raw);
		const minId = config.minId ?? 1;
		if (!Number.isInteger(id) || id < minId) {
			throw new NodeOperationError(ctx.getNode(), `${capital(config.noun)} ID must be a whole number of at least ${minId}`, { itemIndex });
		}
		return id;
	};
	const fieldsProperty: INodeProperties = {
		displayName: 'Fields (JSON)',
		name: 'fieldsJson',
		type: 'json',
		required: true,
		default: '{}',
		description: `Fields of the ${config.noun} as a JSON object, e.g. ${config.fieldsExample}. Get Fields lists every one.`,
	};

	const operations: Operation[] = [];

	for (const kind of kinds) {
		if (kind === 'create') {
			operations.push({
				value: 'create',
				name: 'Create',
				action: `Create a ${config.noun}`,
				description: config.descriptions?.create ?? `Create a ${config.noun}`,
				properties: [...context, fieldsProperty],
				async execute(itemIndex) {
					const fields = jsonParameter<IDataObject>(this, 'fieldsJson', itemIndex, {});
					const body = await bitrix24Request.call(this, methodOf(this, itemIndex, 'create'), { ...contextOf(this, itemIndex), [fieldsKey]: fields }, { itemIndex });
					const result = body.result;
					if (typeof result === 'number' || typeof result === 'string') return { id: result };
					return unwrap(result, config.resultKey);
				},
			});
		}
		if (kind === 'get') {
			operations.push({
				value: 'get',
				name: 'Get',
				action: `Get a ${config.noun}`,
				description: config.descriptions?.get ?? `Retrieve one ${config.noun} by ID`,
				properties: [...context, idProperty],
				async execute(itemIndex) {
					const body = await bitrix24Request.call(this, methodOf(this, itemIndex, 'get'), { ...contextOf(this, itemIndex), [idKeyOf('get')]: readId(this, itemIndex) }, { itemIndex });
					return unwrap(body.result, config.resultKey);
				},
			});
		}
		if (kind === 'getMany') {
			const listParams = config.listParams ?? ['select', 'filter', 'order'];
			const properties: INodeProperties[] = [...context, ...returnAllProperties(config.plural)];
			if (listParams.includes('filter')) {
				properties.push({
					displayName: 'Filter (JSON)',
					name: 'filterJson',
					type: 'json',
					default: '{}',
					description: 'Filter object. Prefix a field with &gt;, &gt;=, &lt;, &lt;=, !, @ (in list) or % (contains).',
				});
			}
			if (listParams.includes('order')) {
				properties.push({
					displayName: 'Order (JSON)',
					name: 'orderJson',
					type: 'json',
					default: '{}',
					description: 'Sort object of field names and ASC or DESC',
				});
			}
			if (listParams.includes('select')) {
				properties.push({
					displayName: 'Fields to Return',
					name: 'select',
					type: 'string',
					default: '',
					description: 'Comma-separated field names. Leave empty for all.',
				});
			}
			operations.push({
				value: 'getMany',
				name: 'Get Many',
				action: `Get many ${config.plural}`,
				description: config.descriptions?.getMany ?? `List ${config.plural}`,
				properties,
				async execute(itemIndex) {
					const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
					const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
					const params: IDataObject = { ...contextOf(this, itemIndex) };
					if (listParams.includes('filter')) {
						const filter = jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {});
						if (Object.keys(filter).length > 0) params.filter = filter;
					}
					if (listParams.includes('order')) {
						const order = jsonParameter<IDataObject>(this, 'orderJson', itemIndex, {});
						if (Object.keys(order).length > 0) params.order = order;
					}
					if (listParams.includes('select')) {
						const select = stringList(this.getNodeParameter('select', itemIndex, ''));
						if (select.length > 0) params.select = select;
					}
					return await listAll.call(this, methodOf(this, itemIndex, 'getMany'), params, {
						itemsKey: config.listKey,
						idField: config.listIdField,
						limit,
						itemIndex,
					});
				},
			});
		}
		if (kind === 'update') {
			operations.push({
				value: 'update',
				name: 'Update',
				action: `Update a ${config.noun}`,
				description: config.descriptions?.update ?? `Change fields of a ${config.noun}; fields not given stay as they are`,
				properties: [...context, idProperty, fieldsProperty],
				async execute(itemIndex) {
					const fields = jsonParameter<IDataObject>(this, 'fieldsJson', itemIndex, {});
					const body = await bitrix24Request.call(
						this,
						methodOf(this, itemIndex, 'update'),
						{ ...contextOf(this, itemIndex), [idKeyOf('update')]: readId(this, itemIndex), [fieldsKey]: fields },
						{ itemIndex },
					);
					const result = body.result;
					if (result === true || typeof result === 'number') return { id: readId(this, itemIndex), updated: true };
					return unwrap(result, config.resultKey);
				},
			});
		}
		if (kind === 'delete') {
			operations.push({
				value: 'delete',
				name: 'Delete',
				action: `Delete a ${config.noun}`,
				description: config.descriptions?.delete ?? `Delete a ${config.noun}`,
				properties: [...context, idProperty],
				async execute(itemIndex) {
					const id = readId(this, itemIndex);
					await bitrix24Request.call(this, methodOf(this, itemIndex, 'delete'), { ...contextOf(this, itemIndex), [idKeyOf('delete')]: id }, { itemIndex });
					return { id, deleted: true };
				},
			});
		}
		if (kind === 'getFields') {
			operations.push({
				value: 'getFields',
				name: 'Get Fields',
				action: `Get ${config.noun} fields`,
				description: config.descriptions?.getFields ?? `Describe the fields a ${config.noun} has`,
				properties: [...context],
				async execute(itemIndex) {
					const body = await bitrix24Request.call(this, methodOf(this, itemIndex, 'getFields'), contextOf(this, itemIndex), { itemIndex });
					const result = (body.result ?? {}) as IDataObject;
					const fields = (result.fields !== null && typeof result.fields === 'object' ? result.fields : result) as IDataObject;
					return Object.entries(fields).map(([name, meta]) =>
						meta !== null && typeof meta === 'object' ? { name, ...(meta as IDataObject) } : { name, value: meta as string },
					);
				},
			});
		}
	}

	return operations;
}
