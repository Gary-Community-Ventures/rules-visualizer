// Rule format identifier
export type RuleFormat = 'rac' | 'factGraph'

// Fact Graph writable type names — matches Direct File XML element names
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
  | 'PhoneNumber'
  | 'TIN'
  | 'EIN'
  | 'PIN'
  | 'IPPIN'

// Fact Graph validation limit — type names match Direct File XML
export type Limit = {
  type: 'Min' | 'Max' | 'MinLength' | 'MaxLength' | 'Match' | 'Contains' | 'MaxCollectionSize'
  value: string | number
}
