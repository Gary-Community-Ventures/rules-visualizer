type NodeProps = {
  id: string
}

export function Node({ id }: NodeProps) {
  return <div className="border p-5">{id}</div>
}
