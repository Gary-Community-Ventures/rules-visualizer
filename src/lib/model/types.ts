// Rule format identifier
export type RuleFormat = 'rac' | 'factGraph'

// Fact Graph writable type names (native to the format)
export type WritableTypeName =
  | 'String'
  | 'Boolean'
  | 'Dollar'
  | 'Int'
  | 'Short'
  | 'Byte'
  | 'Rational'
  | 'Day'
  | 'Enum'
  | 'MultiEnum'
  | 'Collection'
  | 'CollectionItem'
  | 'Address'
  | 'BankAccount'
  | 'EmailAddress'
  | 'E164Number'
  | 'Tin'
  | 'Ein'
  | 'Pin'
  | 'IpPin'

// Fact Graph validation limit
export type Limit = {
  type:
    | 'min'
    | 'max'
    | 'minLength'
    | 'maxLength'
    | 'match'
    | 'contains'
    | 'maxCollectionSize'
  value: string | number
}
