import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { catalogRows, pickerRows } from './shared/helpers';

function options(rows: IDataObject[], name: (row: IDataObject) => string, value: (row: IDataObject) => string | number): INodePropertyOptions[] {
	return rows.map((row) => ({ name: name(row), value: value(row) })).sort((a, b) => a.name.localeCompare(b.name));
}

async function catalogs(ctx: ILoadOptionsFunctions, variations: boolean): Promise<INodePropertyOptions[]> {
	const rows = (await catalogRows(ctx)).filter((row) => (Number(row.productIblockId) > 0) === variations);
	return options(rows, (row) => `${String(row.name ?? '')} (${row.iblockId ?? row.id})`, (row) => Number(row.iblockId ?? row.id));
}

export const loadOptions = {
	async getCatalogs(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		return [...(await catalogs(this, false)), ...(await catalogs(this, true))];
	},

	async getProductCatalogs(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		return await catalogs(this, false);
	},

	async getVariationCatalogs(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		return await catalogs(this, true);
	},

	/** Sections of the catalog chosen above, or of the product catalog when none is. */
	async getSections(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		let iblockId = Number(this.getCurrentNodeParameter('catalogId') ?? 0) || 0;
		const all = await catalogRows(this);
		const chosen = all.find((row) => Number(row.iblockId ?? row.id) === iblockId);
		// Variations have no sections of their own; they sit in their product's.
		if (chosen !== undefined && Number(chosen.productIblockId) > 0) iblockId = Number(chosen.productIblockId);
		if (iblockId <= 0) {
			const main = all.find((row) => !(Number(row.productIblockId) > 0));
			if (main === undefined) return [];
			iblockId = Number(main.iblockId ?? main.id);
		}
		const rows = await pickerRows(this, 'catalog.section.list', 'sections', { select: ['id', 'name'], filter: { iblockId } });
		return options(rows, (row) => `${String(row.name ?? '')} (${row.id})`, (row) => Number(row.id));
	},

	async getVatRates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const rows = await pickerRows(this, 'catalog.vat.list', 'vats');
		return options(rows, (row) => String(row.name ?? row.rate), (row) => Number(row.id));
	},

	async getMeasures(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const rows = await pickerRows(this, 'catalog.measure.list', 'measures');
		return options(rows, (row) => String(row.measureTitle ?? row.symbolIntl ?? row.symbol ?? row.code ?? row.id), (row) => Number(row.id));
	},

	async getCurrencies(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const rows = await pickerRows(this, 'crm.currency.list', '');
		return options(rows, (row) => `${String(row.FULL_NAME ?? row.CURRENCY)} (${row.CURRENCY})`, (row) => String(row.CURRENCY));
	},

	async getPriceTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const rows = await pickerRows(this, 'catalog.priceType.list', 'priceTypes');
		return options(rows, (row) => `${String(row.name ?? '')}${row.base === 'Y' ? ' (base)' : ''}`, (row) => Number(row.id));
	},

	async getStores(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const rows = await pickerRows(this, 'catalog.store.list', 'stores', { select: ['id', 'title', 'active'] });
		return options(rows, (row) => `${String(row.title || `Store ${row.id}`)}${row.active === 'N' ? ' (inactive)' : ''}`, (row) => Number(row.id));
	},

	async getDocumentTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const rows = await pickerRows(this, 'catalog.enum.getStoreDocumentTypes', 'enum');
		return options(rows, (row) => String(row.name ?? row.id), (row) => String(row.id));
	},

	async getRoundTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const rows = await pickerRows(this, 'catalog.enum.getRoundTypes', 'enum');
		return options(rows, (row) => String(row.name ?? row.id), (row) => Number(row.id));
	},
};
