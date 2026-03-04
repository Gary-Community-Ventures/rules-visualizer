import type { DecisionTable } from '@/lib/model'
import { createInputClause, createOutputClause, createRule } from '@/lib/model'
import { TypeSelector } from '../ui/type-selector'
import { useKnownNames } from '@/lib/use-known-names'
import { Table, TableFeelCell, TableInputCell, TableRow } from '../table'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  PlusIcon,
  TrashIcon,
} from 'lucide-react'

const INPUT_HEADER_COLOR = 'bg-fuchsia-100'
const OUTPUT_HEADER_COLOR = 'bg-cyan-100'

type DecisionTableInputProps = {
  decisionTable: DecisionTable
  updateDecisionTable: (decisionTable: DecisionTable) => void
}

export function DecisionTableInput({
  decisionTable,
  updateDecisionTable,
}: DecisionTableInputProps) {
  const knownNames = useKnownNames()

  const inputCount = decisionTable.inputClauses.length
  const outputCount = decisionTable.outputClauses.length
  const columns = inputCount + outputCount

  // ─── Update Functions ───────────────────────────────────────────

  const updateInputClause = (index: number, inputExpression: string) => {
    const inputClauses = [...decisionTable.inputClauses]
    inputClauses[index] = { ...inputClauses[index], inputExpression }
    updateDecisionTable({ ...decisionTable, inputClauses })
  }

  const updateInputClauseType = (
    index: number,
    typeRef: string | undefined
  ) => {
    const inputClauses = [...decisionTable.inputClauses]
    inputClauses[index] = {
      ...inputClauses[index],
      inputExpressionTypeRef: typeRef,
    }
    updateDecisionTable({ ...decisionTable, inputClauses })
  }

  const updateOutputClause = (index: number, name: string) => {
    const outputClauses = [...decisionTable.outputClauses]
    outputClauses[index] = { ...outputClauses[index], name }
    updateDecisionTable({ ...decisionTable, outputClauses })
  }

  const updateOutputClauseType = (
    index: number,
    typeRef: string | undefined
  ) => {
    const outputClauses = [...decisionTable.outputClauses]
    outputClauses[index] = { ...outputClauses[index], typeRef }
    updateDecisionTable({ ...decisionTable, outputClauses })
  }

  const updateRuleInput = (
    ruleIndex: number,
    entryIndex: number,
    value: string
  ) => {
    const rules = [...decisionTable.rules]
    const inputEntries = [...rules[ruleIndex].inputEntries]
    inputEntries[entryIndex] = value
    rules[ruleIndex] = { ...rules[ruleIndex], inputEntries }
    updateDecisionTable({ ...decisionTable, rules })
  }

  const updateRuleOutput = (
    ruleIndex: number,
    entryIndex: number,
    value: string
  ) => {
    const rules = [...decisionTable.rules]
    const outputEntries = [...rules[ruleIndex].outputEntries]
    outputEntries[entryIndex] = value
    rules[ruleIndex] = { ...rules[ruleIndex], outputEntries }
    updateDecisionTable({ ...decisionTable, rules })
  }

  // ─── Input Clause Actions ───────────────────────────────────────

  const insertInputLeft = (index: number) => {
    const inputClauses = [...decisionTable.inputClauses]
    inputClauses.splice(index, 0, createInputClause())
    const rules = decisionTable.rules.map((rule) => ({
      ...rule,
      inputEntries: [
        ...rule.inputEntries.slice(0, index),
        '-',
        ...rule.inputEntries.slice(index),
      ],
    }))
    updateDecisionTable({ ...decisionTable, inputClauses, rules })
  }

  const insertInputRight = (index: number) => {
    const inputClauses = [...decisionTable.inputClauses]
    inputClauses.splice(index + 1, 0, createInputClause())
    const rules = decisionTable.rules.map((rule) => ({
      ...rule,
      inputEntries: [
        ...rule.inputEntries.slice(0, index + 1),
        '-',
        ...rule.inputEntries.slice(index + 1),
      ],
    }))
    updateDecisionTable({ ...decisionTable, inputClauses, rules })
  }

  const shiftInputLeft = (index: number) => {
    const inputClauses = [...decisionTable.inputClauses]
    ;[inputClauses[index - 1], inputClauses[index]] = [
      inputClauses[index],
      inputClauses[index - 1],
    ]
    const rules = decisionTable.rules.map((rule) => {
      const inputEntries = [...rule.inputEntries]
      ;[inputEntries[index - 1], inputEntries[index]] = [
        inputEntries[index],
        inputEntries[index - 1],
      ]
      return { ...rule, inputEntries }
    })
    updateDecisionTable({ ...decisionTable, inputClauses, rules })
  }

  const shiftInputRight = (index: number) => {
    const inputClauses = [...decisionTable.inputClauses]
    ;[inputClauses[index], inputClauses[index + 1]] = [
      inputClauses[index + 1],
      inputClauses[index],
    ]
    const rules = decisionTable.rules.map((rule) => {
      const inputEntries = [...rule.inputEntries]
      ;[inputEntries[index], inputEntries[index + 1]] = [
        inputEntries[index + 1],
        inputEntries[index],
      ]
      return { ...rule, inputEntries }
    })
    updateDecisionTable({ ...decisionTable, inputClauses, rules })
  }

  const deleteInput = (index: number) => {
    const inputClauses = decisionTable.inputClauses.filter(
      (_, i) => i !== index
    )
    const rules = decisionTable.rules.map((rule) => ({
      ...rule,
      inputEntries: rule.inputEntries.filter((_, i) => i !== index),
    }))
    updateDecisionTable({ ...decisionTable, inputClauses, rules })
  }

  // ─── Output Clause Actions ──────────────────────────────────────

  const insertOutputLeft = (index: number) => {
    const outputClauses = [...decisionTable.outputClauses]
    outputClauses.splice(index, 0, createOutputClause())
    const rules = decisionTable.rules.map((rule) => ({
      ...rule,
      outputEntries: [
        ...rule.outputEntries.slice(0, index),
        '',
        ...rule.outputEntries.slice(index),
      ],
    }))
    updateDecisionTable({ ...decisionTable, outputClauses, rules })
  }

  const insertOutputRight = (index: number) => {
    const outputClauses = [...decisionTable.outputClauses]
    outputClauses.splice(index + 1, 0, createOutputClause())
    const rules = decisionTable.rules.map((rule) => ({
      ...rule,
      outputEntries: [
        ...rule.outputEntries.slice(0, index + 1),
        '',
        ...rule.outputEntries.slice(index + 1),
      ],
    }))
    updateDecisionTable({ ...decisionTable, outputClauses, rules })
  }

  const shiftOutputLeft = (index: number) => {
    const outputClauses = [...decisionTable.outputClauses]
    ;[outputClauses[index - 1], outputClauses[index]] = [
      outputClauses[index],
      outputClauses[index - 1],
    ]
    const rules = decisionTable.rules.map((rule) => {
      const outputEntries = [...rule.outputEntries]
      ;[outputEntries[index - 1], outputEntries[index]] = [
        outputEntries[index],
        outputEntries[index - 1],
      ]
      return { ...rule, outputEntries }
    })
    updateDecisionTable({ ...decisionTable, outputClauses, rules })
  }

  const shiftOutputRight = (index: number) => {
    const outputClauses = [...decisionTable.outputClauses]
    ;[outputClauses[index], outputClauses[index + 1]] = [
      outputClauses[index + 1],
      outputClauses[index],
    ]
    const rules = decisionTable.rules.map((rule) => {
      const outputEntries = [...rule.outputEntries]
      ;[outputEntries[index], outputEntries[index + 1]] = [
        outputEntries[index + 1],
        outputEntries[index],
      ]
      return { ...rule, outputEntries }
    })
    updateDecisionTable({ ...decisionTable, outputClauses, rules })
  }

  const deleteOutput = (index: number) => {
    const outputClauses = decisionTable.outputClauses.filter(
      (_, i) => i !== index
    )
    const rules = decisionTable.rules.map((rule) => ({
      ...rule,
      outputEntries: rule.outputEntries.filter((_, i) => i !== index),
    }))
    updateDecisionTable({ ...decisionTable, outputClauses, rules })
  }

  // ─── Rule Actions ───────────────────────────────────────────────

  const insertRuleAbove = (index: number) => {
    const rules = [...decisionTable.rules]
    rules.splice(index, 0, createRule(inputCount, outputCount))
    updateDecisionTable({ ...decisionTable, rules })
  }

  const insertRuleBelow = (index: number) => {
    const rules = [...decisionTable.rules]
    rules.splice(index + 1, 0, createRule(inputCount, outputCount))
    updateDecisionTable({ ...decisionTable, rules })
  }

  const shiftRuleUp = (index: number) => {
    const rules = [...decisionTable.rules]
    ;[rules[index - 1], rules[index]] = [rules[index], rules[index - 1]]
    updateDecisionTable({ ...decisionTable, rules })
  }

  const shiftRuleDown = (index: number) => {
    const rules = [...decisionTable.rules]
    ;[rules[index], rules[index + 1]] = [rules[index + 1], rules[index]]
    updateDecisionTable({ ...decisionTable, rules })
  }

  const deleteRule = (index: number) => {
    const rules = decisionTable.rules.filter((_, i) => i !== index)
    updateDecisionTable({ ...decisionTable, rules })
  }

  // ─── Get Actions ────────────────────────────────────────────────

  const getActions = (x: number, y: number) => {
    const isHeaderRow = y === 0
    const isInputColumn = x < inputCount
    const ruleIndex = y - 1

    if (isHeaderRow) {
      if (isInputColumn) {
        // Input header actions
        const isFirst = x === 0
        const isLast = x === inputCount - 1

        const insertActions = [
          {
            name: 'Insert input left',
            action: () => insertInputLeft(x),
            Icon: PlusIcon,
          },
          {
            name: 'Insert input right',
            action: () => insertInputRight(x),
            Icon: PlusIcon,
          },
        ]

        const shiftActions = [
          ...(!isFirst
            ? [
                {
                  name: 'Shift left',
                  action: () => shiftInputLeft(x),
                  Icon: ArrowLeftIcon,
                },
              ]
            : []),
          ...(!isLast
            ? [
                {
                  name: 'Shift right',
                  action: () => shiftInputRight(x),
                  Icon: ArrowRightIcon,
                },
              ]
            : []),
        ]

        const deleteActions = [
          {
            name: 'Delete input',
            action: () => deleteInput(x),
            Icon: TrashIcon,
            variant: 'destructive' as const,
          },
        ]

        return [
          insertActions,
          ...(shiftActions.length > 0 ? [shiftActions] : []),
          deleteActions,
        ]
      } else {
        // Output header actions
        const outputIndex = x - inputCount
        const isFirst = outputIndex === 0
        const isLast = outputIndex === outputCount - 1

        const insertActions = [
          {
            name: 'Insert output left',
            action: () => insertOutputLeft(outputIndex),
            Icon: PlusIcon,
          },
          {
            name: 'Insert output right',
            action: () => insertOutputRight(outputIndex),
            Icon: PlusIcon,
          },
        ]

        const shiftActions = [
          ...(!isFirst
            ? [
                {
                  name: 'Shift left',
                  action: () => shiftOutputLeft(outputIndex),
                  Icon: ArrowLeftIcon,
                },
              ]
            : []),
          ...(!isLast
            ? [
                {
                  name: 'Shift right',
                  action: () => shiftOutputRight(outputIndex),
                  Icon: ArrowRightIcon,
                },
              ]
            : []),
        ]

        const deleteActions = [
          {
            name: 'Delete output',
            action: () => deleteOutput(outputIndex),
            Icon: TrashIcon,
            variant: 'destructive' as const,
          },
        ]

        return [
          insertActions,
          ...(shiftActions.length > 0 ? [shiftActions] : []),
          deleteActions,
        ]
      }
    } else {
      // Rule row actions
      const isFirstRule = ruleIndex === 0
      const isLastRule = ruleIndex === decisionTable.rules.length - 1

      const insertActions = [
        {
          name: 'Insert rule above',
          action: () => insertRuleAbove(ruleIndex),
          Icon: PlusIcon,
        },
        {
          name: 'Insert rule below',
          action: () => insertRuleBelow(ruleIndex),
          Icon: PlusIcon,
        },
      ]

      const shiftActions = [
        ...(!isFirstRule
          ? [
              {
                name: 'Shift up',
                action: () => shiftRuleUp(ruleIndex),
                Icon: ArrowUpIcon,
              },
            ]
          : []),
        ...(!isLastRule
          ? [
              {
                name: 'Shift down',
                action: () => shiftRuleDown(ruleIndex),
                Icon: ArrowDownIcon,
              },
            ]
          : []),
      ]

      const deleteActions = [
        {
          name: 'Delete rule',
          action: () => deleteRule(ruleIndex),
          Icon: TrashIcon,
          variant: 'destructive' as const,
        },
      ]

      return [
        insertActions,
        ...(shiftActions.length > 0 ? [shiftActions] : []),
        deleteActions,
      ]
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        {decisionTable.inputClauses.map((input, i) => (
          <div key={input.id} className="flex-1 min-w-0">
            <TypeSelector
              value={input.inputExpressionTypeRef}
              onChange={(v) => updateInputClauseType(i, v)}
              placeholder="Input type..."
              className="w-full"
            />
          </div>
        ))}
        {decisionTable.outputClauses.map((output, i) => (
          <div key={output.id} className="flex-1 min-w-0">
            <TypeSelector
              value={output.typeRef}
              onChange={(v) => updateOutputClauseType(i, v)}
              placeholder="Output type..."
              className="w-full"
            />
          </div>
        ))}
      </div>
      <Table columns={columns} getActions={getActions}>
        <TableRow>
          {decisionTable.inputClauses.map((input, i) => (
            <TableFeelCell
              key={input.id}
              className={INPUT_HEADER_COLOR}
              value={input.inputExpression}
              onChange={(v) => updateInputClause(i, v)}
              dialect="expression"
              knownNames={knownNames}
            />
          ))}
          {decisionTable.outputClauses.map((output, i) => (
            <TableInputCell
              key={output.id}
              className={`${OUTPUT_HEADER_COLOR}`}
              value={output.name}
              onChange={(v) => updateOutputClause(i, v.replace(/ /g, '_'))}
            />
          ))}
        </TableRow>
      {decisionTable.rules.map((rule, ruleIndex) => (
        <TableRow key={rule.id}>
          {rule.inputEntries.map((input, entryIndex) => (
            <TableFeelCell
              key={`${rule.id}-in-${entryIndex}`}
              value={input}
              onChange={(v) => updateRuleInput(ruleIndex, entryIndex, v)}
              dialect="unaryTests"
              knownNames={knownNames}
            />
          ))}
          {rule.outputEntries.map((output, entryIndex) => (
            <TableFeelCell
              key={`${rule.id}-out-${entryIndex}`}
              value={output}
              onChange={(v) => updateRuleOutput(ruleIndex, entryIndex, v)}
              dialect="expression"
              knownNames={knownNames}
            />
          ))}
        </TableRow>
      ))}
      </Table>
    </div>
  )
}
