type NodeProps = {
  id: string
}

export function Node({ id }: NodeProps) {
  return <div className="border p-5">{id}</div>
}

type RowsProps = {
  rows: string[][]
}

export function Rows({ rows }: RowsProps) {
  return (
    <div className="flex flex-col gap-5">
      {rows.map((row, i) => {
        return (
          <div key={i} className="flex gap-5 justify-center">
            {row.map((id) => {
              return <Node id={id} key={id} />
            })}
          </div>
        )
      })}
    </div>
  )
}
