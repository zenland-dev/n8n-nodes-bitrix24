import type { IDataObject, IExecuteFunctions, INodeExecutionData, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import type { BatchCommand } from '../../../shared/batch';
import { BATCH_LIMIT, runBatch } from '../../../shared/batch';
import { asNodeError, readFailure } from '../../../shared/errors';
import { jsonParameter, jsonValue } from '../../../shared/params';
import type { Resource } from '../../../shared/spec';

/** A batch command's error arrives as {error, error_description}; make it one line. */
function describeError(error: unknown): string {
	const failure = readFailure(error, 400);
	if (failure === undefined) return JSON.stringify(error);
	return failure.code !== '' && failure.description !== ''
		? `${failure.description} [${failure.code}]`
		: failure.description || failure.code;
}

async function callForEachItem(this: IExecuteFunctions): Promise<INodeExecutionData[]> {
	const items = this.getInputData();
	const halt = this.getNodeParameter('haltOnError', 0, false) as boolean;
	const output: INodeExecutionData[] = [];

	const commands: Array<[string, BatchCommand]> = [];
	for (let index = 0; index < items.length; index++) {
		try {
			const method = String(this.getNodeParameter('method', index)).trim();
			const params = jsonParameter<IDataObject>(this, 'parameters', index, {});
			commands.push([`i${index}`, { method, params }]);
		} catch (error) {
			if (!this.continueOnFail()) throw asNodeError(this.getNode(), error, index);
			output.push({ json: { error: (error as Error).message }, pairedItem: { item: index } });
		}
	}

	const outcomes = await runBatch.call(this, commands, { halt });

	for (const outcome of outcomes) {
		const index = Number(outcome.key.slice(1));
		if (outcome.error !== undefined) {
			if (!this.continueOnFail()) {
				throw new NodeApiError(this.getNode(), (outcome.error ?? {}) as JsonObject, {
					message: `Bitrix24 ${outcome.method}: ${describeError(outcome.error)}`,
					description:
						'Every other call of this run has already been sent, and the ones that succeeded are not undone. Turn on Continue On Fail to get one result or error per item instead.',
					itemIndex: index,
				});
			}
			output.push({
				json: { error: describeError(outcome.error), details: outcome.error as IDataObject },
				pairedItem: { item: index },
			});
			continue;
		}
		if (outcome.result === undefined) {
			// With Halt On Error, commands after a failure are not run and come back empty.
			output.push({ json: { skipped: true }, pairedItem: { item: index } });
			continue;
		}
		const result = outcome.result;
		output.push({
			json:
				result !== null && typeof result === 'object' && !Array.isArray(result)
					? (result as IDataObject)
					: { result: result as IDataObject[keyof IDataObject] },
			pairedItem: { item: index },
		});
	}

	output.sort((a, b) => {
		const left = (a.pairedItem as { item: number }).item;
		const right = (b.pairedItem as { item: number }).item;
		return left - right;
	});
	return output;
}

export const batchResource: Resource = {
	value: 'batch',
	name: 'Batch',
	description: 'Send up to 50 method calls in one request',
	operations: [
		{
			value: 'execute',
			name: 'Execute Commands',
			action: 'Execute a batch of Bitrix24 commands',
			description:
				'Run a list of named REST calls in one request; later commands may use earlier results through $result[name]',
			properties: [
				{
					displayName: 'Define Commands',
					name: 'commandsMode',
					type: 'options',
					default: 'fields',
					options: [
						{ name: 'Using Fields Below', value: 'fields' },
						{ name: 'Using JSON', value: 'json' },
					],
				},
				{
					displayName: 'Commands',
					name: 'commands',
					type: 'fixedCollection',
					typeOptions: { multipleValues: true },
					default: {},
					placeholder: 'Add Command',
					displayOptions: { show: { commandsMode: ['fields'] } },
					options: [
						{
							displayName: 'Command',
							name: 'command',
							values: [
								{
									displayName: 'Name',
									name: 'key',
									type: 'string',
									default: '',
									placeholder: 'deal',
									description:
										'Unique name of this command. A later command can read its result as $result[name], e.g. $result[deal][item][title].',
								},
								{
									displayName: 'Method',
									name: 'method',
									type: 'string',
									default: '',
									placeholder: 'crm.item.add',
								},
								{
									displayName: 'Parameters (JSON)',
									name: 'parameters',
									type: 'json',
									default: '{}',
								},
							],
						},
					],
				},
				{
					displayName: 'Commands (JSON)',
					name: 'commandsJson',
					type: 'json',
					default: '{\n  "deal": {"method": "crm.item.get", "params": {"entityTypeId": 2, "id": 1}}\n}',
					displayOptions: { show: { commandsMode: ['json'] } },
					description:
						'An object of named commands, each {"method": "...", "params": {...}}. Order is kept.',
				},
				{
					displayName: 'Halt on Error',
					name: 'haltOnError',
					type: 'boolean',
					default: false,
					description:
						'Whether Bitrix24 should stop running the rest of the batch after the first failed command',
				},
				{
					displayName: 'Output',
					name: 'batchOutput',
					type: 'options',
					default: 'perCommand',
					options: [
						{
							name: 'One Item per Command',
							value: 'perCommand',
							description: 'Each item holds the command name, its result or its error',
						},
						{
							name: 'Single Item',
							value: 'single',
							description: 'One item with results and errors keyed by command name',
						},
					],
				},
			],
			async execute(itemIndex) {
				const mode = this.getNodeParameter('commandsMode', itemIndex) as string;
				const halt = this.getNodeParameter('haltOnError', itemIndex) as boolean;
				const commands: Array<[string, BatchCommand]> = [];

				if (mode === 'json') {
					const defined = jsonParameter<IDataObject>(this, 'commandsJson', itemIndex, {});
					for (const [key, value] of Object.entries(defined)) {
						const command = (value ?? {}) as IDataObject;
						commands.push([key, { method: String(command.method ?? ''), params: (command.params ?? {}) as IDataObject }]);
					}
				} else {
					const defined = (this.getNodeParameter('commands.command', itemIndex, []) ?? []) as IDataObject[];
					defined.forEach((command, position) => {
						const key = String(command.key ?? '').trim() || `cmd${position + 1}`;
						const params = jsonValue<IDataObject>(this, command.parameters, `Parameters of ${key}`, itemIndex, {});
						commands.push([key, { method: String(command.method ?? '').trim(), params }]);
					});
				}

				if (commands.length === 0) {
					throw new NodeOperationError(this.getNode(), 'Add at least one command', { itemIndex });
				}
				if (commands.length > BATCH_LIMIT) {
					throw new NodeOperationError(this.getNode(), `A batch holds at most ${BATCH_LIMIT} commands`, {
						itemIndex,
						description:
							'References like $result[name] only work inside one request, so a longer list cannot be split safely. Use Call for Each Item for independent calls.',
					});
				}
				const keys = new Set(commands.map(([key]) => key));
				if (keys.size !== commands.length) {
					throw new NodeOperationError(this.getNode(), 'Command names must be unique', { itemIndex });
				}

				const outcomes = await runBatch.call(this, commands, { halt, itemIndex });

				if (this.getNodeParameter('batchOutput', itemIndex) === 'single') {
					const results: IDataObject = {};
					const errors: IDataObject = {};
					for (const outcome of outcomes) {
						if (outcome.result !== undefined) results[outcome.key] = outcome.result as IDataObject;
						if (outcome.error !== undefined) errors[outcome.key] = outcome.error as IDataObject;
					}
					return { results, errors };
				}

				return outcomes.map((outcome) => {
					const row: IDataObject = { name: outcome.key, method: outcome.method };
					if (outcome.result !== undefined) row.result = outcome.result as IDataObject;
					if (outcome.error !== undefined) row.error = describeError(outcome.error);
					if (outcome.total !== undefined) row.total = outcome.total as number;
					if (outcome.next !== undefined) row.next = outcome.next as number;
					return row;
				});
			},
		},
		{
			value: 'callForEachItem',
			name: 'Call for Each Item',
			action: 'Call a method for every input item in batches',
			description:
				'Make the same kind of call once per input item, packed 50 to a request — e.g. create 500 leads in 10 requests instead of 500',
			properties: [
				{
					displayName: 'Method',
					name: 'method',
					type: 'string',
					required: true,
					default: '',
					placeholder: 'crm.item.add',
					description: 'REST method to call for each item',
				},
				{
					displayName: 'Parameters (JSON)',
					name: 'parameters',
					type: 'json',
					default: '{}',
					description:
						'Parameters for one item, filled from that item with expressions, e.g. {"entityTypeId": 1, "fields": {"title": "…"}}',
				},
				{
					displayName: 'Halt on Error',
					name: 'haltOnError',
					type: 'boolean',
					default: false,
					description:
						'Whether Bitrix24 should skip the remaining calls of a 50-call request after one fails. Calls already made are not undone.',
				},
			],
			executeAll: callForEachItem,
		},
	],
};
