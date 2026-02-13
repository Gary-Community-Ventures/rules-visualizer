import { ContextInput } from '@/components/inputs/context'
import type { Context } from '@/lib/model'
import { useState } from 'react'

// export function TestPage() {
//   const [value, setValue] = useState('test')
//   return (
//     <div className="p-10">
//       <Table columns={4}>
//         <TableRow>
//           <TableTextCell>test</TableTextCell>
//           <TableTextCell>test</TableTextCell>
//           <TableTextCell>test</TableTextCell>
//           <TableTextCell>test</TableTextCell>
//         </TableRow>
//         <TableRow>
//           <TableInputCell value={value} onChange={(v) => setValue(v)} />
//           <TableInputCell value={value} onChange={(v) => setValue(v)} />
//           <TableInputCell value={value} onChange={(v) => setValue(v)} />
//           <TableInputCell value={'test'} onChange={(v) => setValue(v)} />
//         </TableRow>
//         <TableRow>
//           <TableInputCell value={value} onChange={(v) => setValue(v)} />
//           <TableInputCell value={value} onChange={(v) => setValue(v)} />
//           <TableInputCell value={value} onChange={(v) => setValue(v)} />
//           <TableInputCell value={value} onChange={(v) => setValue(v)} />
//         </TableRow>
//         <TableRow>
//           <TableTextCell>return</TableTextCell>
//           <TableInputCell value={value} onChange={(v) => setValue(v)} />
//           <TableInputCell value={value} onChange={(v) => setValue(v)} />
//           <TableInputCell value={value} onChange={(v) => setValue(v)} />
//         </TableRow>
//       </Table>
//     </div>
//   )
// }

export function TestPage() {
  const [context, setContext] = useState<Context>({
    type: 'context',
    entries: [
      {
        id: 'test',
        name: 'test',
        expression: {
          text: 'test',
        },
      },
      {
        id: 'test',
        name: 'test',
        expression: {
          text: 'test',
        },
      },
    ],
  })

  return <ContextInput context={context} updateContext={setContext} />
}
