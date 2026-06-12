# Input dictionary — v2 eligibility adapter request

<!-- GENERATED FILE — do not edit by hand. -->
<!-- Source: scripts/generate-input-dictionary.ts joining src/v2-field-map.ts with the rulesets. -->
<!-- Regenerate: npm run gen:dictionary --workspace=rules-visualizer-factgraph-api -->

Authoritative definitions for every field in the [v2 draft contract](./eligibility-adapter-v2-proposal-openapi.yaml).
Definitions, data types, enum vocabularies, and policy citations are pulled
directly from the rulesets — the same text the rule authors wrote against
the regulations — so this document cannot drift from what the rules
actually mean. A filterable version lives on the
[docs site](https://gary-community-ventures.github.io/rules-visualizer/dictionary.html).

**Design principle: inputs are observable facts, not program conclusions.**
A fact like "receives SSI" means the same thing to every program; each
program's rules derive its own concepts (e.g. its legal definition of
"disabled" or its household unit) from these facts. Where the inherited
contract carries a conclusion-shaped field (`isDisabled`,
`household.size`), the dictionary notes the precise facts to prefer.

Each entry reads: **type · programs that consume it · kind · source.**
**Kind** is how the adapter maps it — `direct` (passes through), `derived`
(computed; the note says how), `structural` (identity/reference plumbing),
`compat` (carried for contract compatibility; not consumed by the rules).
**Source** is our best guess at where the value realistically originates —
`applicant` (self-attestable on an application form), `state` (records
checks, case history, batch/data-exchange systems), or `either`. These
guesses are offered for the Worker Portal team and the State to correct;
they drive the candidate-additions list below. Fields that already exist
in the partner's published worker-portal contract (the eligibility-
adapter OpenAPI in safety-net-blueprint) are marked ✦ — the candidate-
additions list below is exactly the applicant-attestable fields WITHOUT
that marker.

Which fields are *required*? Per case, not per program: the rules
short-circuit, so the authoritative answer is the response's
`missingInformation` (send what you have; it lists exactly what is still
needed). See "Getting started" at the bottom for practical starting sets.

## Member — identity & demographics

#### `members[].id`

`reference` · no program (see note) · structural

> *Adapter mapping:* Caller handle; echoed on member-scoped decisions. Collection rows are linked positionally inside the engine.

#### `members[].dateOfBirth`

`Int` · SNAP + Medicaid · derived · source: **applicant** · ✦ in the published worker-portal contract

Age of this member in years. If their birthday occurs in the middle of a month, use the age they were when the month began (the last day of the previous month).

> *Adapter mapping:* Age in whole years computed from dateOfBirth as of the evaluation date.

#### `members[].citizenshipStatus`

`Enum` · SNAP + Medicaid · derived · source: **applicant** · ✦ in the published worker-portal contract

This member's selected citizenship or immigration status for SNAP citizenship and non-citizenship eligibility (10 CCR 2506-1, 4.305).

> *Adapter mapping:* Combined with immigrationStatus into each ruleset's citizenship/immigration enum.

Allowed values: `citizen` · `non_citizen_national` · `lawful_permanent_resident` · `parolee` · `asylee` · `refugee` · `withholding_of_deportation_or_removal` · `conditional_entrant` · `cuban_or_haitian_entrant` · `battered_immigrant` · `victim_of_trafficking` · `amerasian` · `iraqi_or_afghan_special_immigrant` · `american_indian_born_abroad` · `hmong_or_highland_laotian_tribal_member` · `other_non_citizen`

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 7, 8, 10, 12, 53, 54, 55, 56, 57

#### `members[].immigrationStatus`

`Enum` · SNAP + Medicaid · derived · source: **applicant** · ✦ in the published worker-portal contract

This member's selected citizenship or immigration status for SNAP citizenship and non-citizenship eligibility (10 CCR 2506-1, 4.305).

> *Adapter mapping:* Present when citizenshipStatus is non_citizen; refines the mapped enum value.

Allowed values: `citizen` · `non_citizen_national` · `lawful_permanent_resident` · `parolee` · `asylee` · `refugee` · `withholding_of_deportation_or_removal` · `conditional_entrant` · `cuban_or_haitian_entrant` · `battered_immigrant` · `victim_of_trafficking` · `amerasian` · `iraqi_or_afghan_special_immigrant` · `american_indian_born_abroad` · `hmong_or_highland_laotian_tribal_member` · `other_non_citizen`

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 7, 8, 10, 12, 53, 54, 55, 56, 57

#### `members[].relationshipToHead`

`Boolean` · SNAP · derived · source: **applicant** · ✦ in the published worker-portal contract

Whether this member is the head of the SNAP household — the person to whom the local office addresses correspondence and notices about the household's case, generally the individual who completes the application process and is responsible for obtaining and using the household's EBT card (10 CCR 2506-1, 4.304).

> *Adapter mapping:* head_of_household → true; other values → false.

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 5, 25

#### `members[].spouseId`

`reference` · SNAP · structural

The household member who is this member's spouse — either a person married to this member under state law, or a person living together with this member who is free to marry and is representing themselves as a spouse to relatives, friends, neighbors, or the larger community (10 CCR 2506-1, 4.304.1).

> *Adapter mapping:* Reference to another member id.

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 47

#### `members[].isDisabled`

`Boolean` · SNAP + Medicaid · derived · source: **applicant** · ✦ in the published worker-portal contract

Whether this member has a physical disability

> *Adapter mapping:* Coarse ORCA flag. Ambiguous across programs — prefer disabilityDetails, which decomposes it into the observable facts each program's definition derives from.

## Member — pregnancy

#### `members[].pregnancy.isPregnant`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member is pregnant for purposes of the ABAWD exemption from the ABAWD work requirement (10 CCR 2506-1, 4.311.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 81

#### `members[].pregnancy.expectedChildren`

`Int` · Medicaid · direct · source: **applicant**

Number of children expected from this member's current pregnancy (0 if not pregnant). Adds to household size for FPL.

#### `members[].pregnancy.endDate`

`Int` · Medicaid · derived · source: **applicant**

Days since this member's pregnancy ended (used for postpartum coverage).

> *Adapter mapping:* Days since pregnancy computed from endDate as of the evaluation date.

## Member — veteran status

#### `members[].veteranStatus.isVeteran`

`Boolean` · SNAP + Medicaid · direct · source: **applicant**

Whether this member is a veteran for purposes of the ABAWD exemption from the ABAWD work requirement (10 CCR 2506-1, 4.311.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 81

#### `members[].veteranStatus.hasDisability`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member is a veteran with a service-connected disability rated or paid as a total disability under Title 38 of the United States Code, or is a veteran receiving a pension for a non-service-connected disability (10 CCR 2506-1, 4.000.1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 9

#### `members[].veteranStatus.needsAidAndAttendance`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member is a veteran considered by the Veterans Affairs (VA) to be in need of regular aid and attendance or permanently housebound under Title 38 of the United States Code (10 CCR 2506-1, 4.000.1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 9

#### `members[].veteranStatus.survivorNeedsAidAndAttendance`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member is a surviving spouse of a veteran and considered in need of aid and attendance or permanently housebound, or a surviving child of a veteran and considered by the VA to be permanently incapable of self-support under Title 38 of the United States Code (10 CCR 2506-1, 4.000.1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 9

#### `members[].veteranStatus.survivorHasDisability`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member is a surviving spouse or child of a veteran considered by the VA to be entitled to compensation for a service-connected death or pension benefits for a non-service-connected death under Title 38 of the United States Code, and has a disability considered permanent under Section 221(i) of the Social Security Act. "Entitled" refers to those veterans' surviving spouses and children who are receiving the compensation or benefits or have been approved for such benefits but are not yet receiving them (10 CCR 2506-1, 4.000.1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 9

## Member — student status

#### `members[].studentStatus.enrollment`

`Enum` · SNAP + Medicaid · derived · source: **applicant**

This member's enrollment status in an institution of higher education — an institution that normally requires a high school diploma or equivalency certificate for a student to enroll, such as a college, university, or vocational or technical school: full time (a school schedule equivalent to a full-time curriculum as defined by the institution of higher education the person is attending), at least half time but less than full time, or less than half time / not enrolled (10 CCR 2506-1, 4.000.1).

> *Adapter mapping:* snake_case of the rules enum; full_time also sets the medicaid full-time-student flag.

Allowed values: `full_time` · `half_time` · `less_than_half_time_or_not_enrolled`

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 5, 6, 9

#### `members[].studentStatus.inK12`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member is attending a K-12 school (kindergarten through twelfth grade). Persons attending high school are not considered under SNAP student eligibility criteria (10 CCR 2506-1, 4.306, B, 5).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 64

#### `members[].studentStatus.inWorkStudy`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member is participating in a work-study program for purposes of the SNAP student eligibility exemption. The work-study shall be approved for the school term and the student shall anticipate working during that time. The student qualifies for this exemption the month the school term in which the work-study will occur begins or the month work-study is approved, whichever is later. The exemption continues until the end of the school term or until it becomes known that the student has refused an assignment. The exemption shall not continue between terms when there is a break of one (1) full month or longer unless the student is participating in work-study during the break (10 CCR 2506-1, 4.306.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 65

#### `members[].studentStatus.assignedByEmploymentTrainingProgram`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member qualifies for the SNAP student eligibility exemption as a student assigned to or placed in an institution of higher education through a program under the Workforce Innovation and Opportunity Act (WIOA), Employment First (EF), a program under Section 236 of the Trade Act of 1974 (19 U.S.C. 2296), another program for the purpose of employment and training operated by the state or local government (program shall have at least one (1) component equivalent to the SNAP EF Program), or as a result of participating in the JOBS program under Title IV of the Social Security Act (10 CCR 2506-1, 4.306.1, G).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 65, 66

#### `members[].studentStatus.unfitForEmployment`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member is physically or mentally unfit for employment for purposes of the SNAP student eligibility exemption. This student-specific flag is separate from the work-requirements unfitness determination so the two policy contexts can be captured independently (10 CCR 2506-1, 4.306.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 64, 65, 75, 76

## Member — disability details

#### `members[].disabilityDetails.types`

`Boolean` · SNAP · derived · source: **applicant**

Whether this member has a physical disability

> *Adapter mapping:* Array values map to the physical/mental flags ('physical' → hasPhysicalDisability, 'mental' → hasMentalDisability).

#### `members[].disabilityDetails.isIncapacitated`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member is an incapacitated person whose care may qualify one parent or other household member for the SNAP work-requirements exemption (10 CCR 2506-1, 4.310).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 75

#### `members[].disabilityDetails.unableToPrepareMeals`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member is experiencing a disability and, as a result of that disability, is unable to purchase and prepare their own meals. This captures the functional disability condition for the elderly/disabled household-composition rule and is distinct from the broader disability definition used elsewhere in SNAP eligibility (10 CCR 2506-1, 4.304.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 47, 84

#### `members[].disabilityDetails.receivesDisabilityBenefits`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member receives temporary or permanent disability benefits issued by government or private sources, which is an example of being physically or mentally unfit for employment for SNAP work-requirements purposes (10 CCR 2506-1, 4.310).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 76, 80

#### `members[].disabilityDetails.receivesPublicDisabilityPension`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member has a disability considered permanent under Section 221(i) of the Social Security Act and receives a federal, state, or local public disability retirement pension (10 CCR 2506-1, 4.000.1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 9

#### `members[].disabilityDetails.receivesRailroadRetirementDisability`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member receives an annuity for disability from the railroad retirement board and is considered as a person with disabilities by the SSA, or qualifies for Medicare as determined by the railroad retirement board (10 CCR 2506-1, 4.000.1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 9

#### `members[].disabilityDetails.receivesInterimAssistance`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member is a recipient of interim assistance benefits pending the receipt of Supplemental Security Income (SSI), disability-related medical assistance under Title XIX of the Social Security Act, or disability-based state assistance benefits, provided that eligibility for those benefits is based on disability or blindness criteria at least as stringent as those used under Title XVI of the Social Security Act (10 CCR 2506-1, 4.000.1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 9

#### `members[].disabilityDetails.ssiApplicationPending`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member is applying for and/or appealing Supplemental Security Income (SSI) benefits, which is an example of being physically or mentally unfit for employment for SNAP work-requirements purposes (10 CCR 2506-1, 4.310).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 76

#### `members[].disabilityDetails.inVocationalRehabilitation`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member is participating in vocational rehabilitation, which is an example of being physically or mentally unfit for employment for SNAP work-requirements purposes (10 CCR 2506-1, 4.310).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 76

#### `members[].disabilityDetails.hasDisabledChild`

`Boolean` · Medicaid · direct · source: **applicant**

Whether this member has a child with a disability in the household.

## Member — living situation

#### `members[].livingSituation.settings`

`Boolean` · SNAP · derived · source: **applicant**

Whether this member lives in an establishment that is licensed as a commercial enterprise and which offers meals and lodging for compensation, as described in 7 C.F.R 273.1(b)(3)(i) (10 CCR 2506-1, 4.000.1)

> *Adapter mapping:* Each array value sets the corresponding flag; settings can co-occur.

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 2, 52

#### `members[].livingSituation.isExperiencingHomelessness`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member lacks a fixed and regular nighttime residence or whose primary residence is a supervised shelter designed for temporary accommodations; a halfway house or similar facility that provides temporary residence; a place not designed for or ordinarily used as regular sleeping accommodations for human beings; or a temporary accommodation in the residence of another individual for ninety (90) days or less (10 CCR 2506-1, 4.000.1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 9

#### `members[].livingSituation.isBoarder`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member is a boarder of the client's household. Boarders are only considered members of a client's SNAP household if the household requests that they be considered household members (10 CCR 2506-1, 4.304.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 2, 49

#### `members[].livingSituation.isRoomer`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member is an individual to whom a household furnishes lodging, but not meals, for compensation (10 CCR 2506-1, 4.000.1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 11, 50

#### `members[].livingSituation.isLiveInAttendant`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member resides with the household to provide child-care or other personal services (10 CCR 2506-1, 4.000.1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 7, 50

#### `members[].livingSituation.isSeparateAndApart`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member, who would otherwise be a mandatory household member, has established a residence separate and apart from the other mandatory household members. A residence is only considered established as separate and apart when the individual pays shelter expenses, supports the maintenance of the other residence (e.g., paying rent/mortgage, utilities, insurance, or other charges necessary to maintain the residence), or has provided that separate address to other governmental organizations or an employer as their primary residence. When true, the member is not required to be considered part of the SNAP household, and any monies that person provides to the SNAP household should be considered unearned income (10 CCR 2506-1, 4.304.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 50, 51

#### `members[].livingSituation.preparesFoodWithHousehold`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member customarily purchases and prepares food together with the rest of the household for home consumption (10 CCR 2506-1, 4.000.1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 6, 69

#### `members[].livingSituation.recentlyReleasedFromInstitution`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member was recently released from an institution, which is an example of being physically or mentally unfit for employment for SNAP work-requirements purposes (10 CCR 2506-1, 4.310).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 75

#### `members[].livingSituation.participatesInAnotherHousehold`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member is already receiving SNAP benefits as part of another SNAP household or in another state in the same calendar month (10 CCR 2506-1, 4.000.1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 4

## Member — work requirements

#### `members[].workRequirements.registeredForWork`

`Boolean` · SNAP · direct · source: **state**

Whether this non-exempt member registered for work at initial application and at every recertification by signing the application for assistance or recertification, either personally or through an authorized representative or another adult household member (10 CCR 2506-1, 4.310).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 74

#### `members[].workRequirements.providedEmploymentInfo`

`Boolean` · SNAP · direct · source: **state**

Whether this non-exempt member provided the eligibility technician sufficient information regarding employment status or availability for work (10 CCR 2506-1, 4.310).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 74

#### `members[].workRequirements.reportedToReferredEmployer`

`Boolean` · SNAP · direct · source: **state**

Whether this non-exempt member reported to an employer when referred by the local office and the potential employment was suitable employment (10 CCR 2506-1, 4.310).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 74

#### `members[].workRequirements.inEmploymentTrainingProgram`

`Boolean` · SNAP · direct · source: **either**

Whether this member is enrolled in the Employment and Training Program (Employment First/EF), a program operated by the Department of Human Services consisting of work, training, education, work experience, and/or job search activities designed to help clients obtain gainful employment (10 CCR 2506-1, 4.000.1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 4

#### `members[].workRequirements.appliedForOrReceivingUnemployment`

`Boolean` · SNAP · direct · source: **either**

Whether this member is applying for or receiving Unemployment Insurance Benefits (UIB), including a person denied UIB who is appealing the decision, for purposes of the SNAP general work requirement exemption (10 CCR 2506-1, 4.310).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 76

#### `members[].workRequirements.inDrugOrAlcoholTreatment`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member is a regular participant in a drug or alcohol treatment or rehabilitation program for purposes of the SNAP general work requirement exemption (10 CCR 2506-1, 4.310).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 76

#### `members[].workRequirements.complyingWithOtherWorkProgram`

`Boolean` · SNAP · direct · source: **state**

Whether this member is subject to and complying with Colorado Works (CW) or the Colorado Refugee Services Program (CRSP) work programs for purposes of the SNAP general work requirement exemption (10 CCR 2506-1, 4.310).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 76

#### `members[].workRequirements.abawdWaiverExempt`

`Boolean` · SNAP · direct · source: **state**

Whether this member is exempt from the ABAWD work requirement under a waiver approved by USDA FNS (10 CCR 2506-1, 4.311.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 81

#### `members[].workRequirements.abawdStateExemption`

`Boolean` · SNAP · direct · source: **state**

Whether this member is exempt from the ABAWD work requirement using a Colorado-defined state exemption identified in the current SNAP Employment and Training State Plan (10 CCR 2506-1, 4.311.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 81

#### `members[].workRequirements.abawdWorkProgramHoursPerWeek`

`Int` · SNAP · direct · source: **applicant**

This member's weekly hours participating in and complying with a qualifying ABAWD work program, including a CDHS-operated or supervised employment and training program other than job search or job-search training, a WIOA program, or a Trade Act Section 236 program (10 CCR 2506-1, 4.000.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 80

#### `members[].workRequirements.abawdCountableMonthsUsed`

`Int` · SNAP · direct · source: **state**

The number of countable months accrued by this member within the past 36 months. A countable month is a month in which an ABAWD received a full SNAP allotment but did not meet work requirements or have an exemption from those requirements. ABAWDs who accrue three countable months within a 36-month period become disqualified from SNAP unless they meet an exemption or ABAWD work requirements (10 CCR 2506-1, 4.000.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 3, 4, 81, 82

#### `members[].workRequirements.participatesInWorkfare`

`Boolean` · SNAP · direct · source: **state**

Whether this member is participating in and complying with the Colorado Workfare program for purposes of fulfilling the ABAWD work requirement (10 CCR 2506-1, 4.000.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 80

#### `members[].workRequirements.unableToMaintainEmployment`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member is unable to maintain employment, which is an example of being physically or mentally unfit for employment for SNAP work-requirements purposes (10 CCR 2506-1, 4.310).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 76

#### `members[].workRequirements.impactedByDomesticViolence`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member is impacted by domestic violence, which is an example of being physically or mentally unfit for employment for SNAP work-requirements purposes (10 CCR 2506-1, 4.310).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 76

#### `members[].workRequirements.temporaryConditionPreventsWork`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member has a self-declared temporary condition that would prevent successful participation in work activities, which is an example of being physically or mentally unfit for employment for SNAP work-requirements purposes (10 CCR 2506-1, 4.310).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 76

#### `members[].workRequirements.otherUnfitnessReason`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member has another valid reason, not otherwise listed, for being physically or mentally unfit for employment for SNAP work-requirements purposes. The listed examples of unfitness are not exhaustive (10 CCR 2506-1, 4.310).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 75

#### `members[].workRequirements.isMigrantFarmWorker`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member travels away from home on a regular basis to follow the flow of seasonal agricultural work (10 CCR 2506-1, 4.000.1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 7

#### `members[].workRequirements.striker.isStriker`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member is involved in a strike or other concerted stoppage of work by employees, including a stoppage by reason of the expiration of a collective bargaining agreement and any concerted slowdown or other concerted interruption of operations by employees (10 CCR 2506-1, 4.000.1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 12, 66

#### `members[].workRequirements.striker.eligibleDayBeforeStrike`

`Boolean` · SNAP · direct · source: **applicant**

Whether the household containing this striking member was eligible for SNAP the day before the strike. A household containing a striker is only eligible for SNAP if the household was eligible the day before the strike and is otherwise eligible at the time of the strike (10 CCR 2506-1, 4.305).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 66

#### `members[].workRequirements.striker.exemptFromRegistrationDayBeforeStrike`

`Boolean` · SNAP · direct · source: **applicant**

Whether this striking member was exempt from work registration the day before the strike, such as the caretaker of a child under six (6) years of age, other than persons exempt solely on the ground that they were employed. Households where the striking member was so exempt are not subject to the striker eligibility restriction (10 CCR 2506-1, 4.305, A and D).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 66

## Member — immigration details

#### `members[].immigrationDetails.qualifiedYearsInUs`

`Int` · SNAP · direct · source: **applicant**

The number of years this non-citizen has lived in the U.S. in a qualified non-citizen status. The waiting period begins on the date the non-citizen obtains status as a qualified non-citizen or enters the U.S. in a qualifying status (10 CCR 2506-1, 4.305, B, 3, a).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 57

#### `members[].immigrationDetails.qualifyingWorkQuarters`

`Int` · SNAP · direct · source: **either**

The total number of qualifying work quarters credited to this non-citizen under Title II of the Social Security Act. The sum may include the non-citizen's own quarters, quarters credited from the work of a parent while the non-citizen was under eighteen (18), and quarters credited from the work of the non-citizen's spouse, subject to the restrictions in 4.305, B, 3, b (10 CCR 2506-1, 4.305, B, 3, b).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 57, 58

#### `members[].immigrationDetails.lawfullyResidedSince1996Senior`

`Boolean` · SNAP · direct · source: **applicant**

Whether this non-citizen was born on or before August 22, 1931 and lawfully resided in the U.S. on August 22, 1996 (10 CCR 2506-1, 4.305, B, 3, e).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 58

#### `members[].immigrationDetails.qualifyingMilitaryConnection`

`Boolean` · SNAP · direct · source: **applicant**

Whether this qualified non-citizen has a qualifying military connection: an individual lawfully residing in a state on active duty (other than training) in the military, excluding national guard; an honorably discharged veteran (as defined in Section 101 of Title 38, U.S.C.) whose discharge is not because of immigration status and who fulfills the minimum active-duty service requirements, including an individual who died in active military, naval, or air service; or the spouse, un-remarried surviving spouse, or unmarried dependent child of such a person, as further defined in 4.305, B, 3, f (10 CCR 2506-1, 4.305, B, 3, f).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 58, 59

#### `members[].immigrationDetails.sponsor.memberId`

`reference` · SNAP · structural

The household member who executed an affidavit of support (USCIS form I-864A) or another form deemed legally binding by the Department of Homeland Security on behalf of this non-citizen as a condition of the non-citizen's entry or admission into the United States as a permanent resident (10 CCR 2506-1, 4.000.1)

> *Adapter mapping:* Reference to another member id, when the sponsor is in the household.

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 11, 60

#### `members[].immigrationDetails.sponsor.isOrganization`

`Boolean` · SNAP · direct · source: **applicant**

Whether this non-citizen is sponsored by an organization or group as opposed to an individual, which exempts the non-citizen from sponsor income and resource deeming (10 CCR 2506-1, 4.000.1, E, 2).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 61

#### `members[].immigrationDetails.sponsor.dependentCount`

`Int` · SNAP · direct · source: **applicant**

The number of other people who are claimed or could be claimed for federal income tax purposes as a dependent by this sponsored non-citizen's sponsor or the sponsor's spouse, used to size the sponsor's tax household in sponsor income deeming (10 CCR 2506-1, 4.000.1, D, 2, b).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 60

#### `members[].immigrationDetails.sponsor.otherSponsoredNonCitizens`

`Int` · SNAP · direct · source: **applicant**

The number of sponsored non-citizens this member sponsors who are not members of this SNAP household, as demonstrated by a sponsored non-citizen in this household to the local office's satisfaction (10 CCR 2506-1, 4.000.1, D, 2, c).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 61

## Member — caseworker findings (never defaulted)

#### `members[].findings.ipvDisqualification`

`Boolean` · SNAP · direct · source: **state**

Whether this member has been disqualified for an Intentional Program Violation/fraud (10 CCR 2506-1, 4.000.1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 4, 5, 6, 177, 205, 208, 209

#### `members[].findings.snapDrugFelonyConviction`

`Boolean` · SNAP · direct · source: **state**

Whether this member has been convicted of a drug-related felony where SNAP benefits were used to purchase drugs. Drug-related felony has the same meaning as in 7 C.F.R. 273.11(m) (10 CCR 2506-1, 4.206).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 35

#### `members[].findings.ssnNonCompliance`

`Boolean` · SNAP · direct · source: **state**

Whether this member has failed to provide or obtain a Social Security Number (10 CCR 2506-1, 4.000.1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 4, 44, 45, 46

#### `members[].findings.workRequirementsNonCooperation`

`Boolean` · SNAP · direct · source: **state**

Whether this member has been disqualified for failure to cooperate with work requirements (10 CCR 2506-1, 4.000.1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 4

#### `members[].findings.voluntaryQuit`

`Boolean` · SNAP · direct · source: **state**

Whether this member has voluntarily quit a job or reduced their work effort to less than 30 hours a week. Whether the quit or reduction was with good cause is captured separately on /members/*/voluntaryQuitReason (10 CCR 2506-1, 4.000.1; 4.308).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 13, 66, 67, 77

#### `members[].findings.voluntaryQuitReason`

`Enum` · SNAP · direct · source: **state**

The reason for this member's voluntary quit of employment or reduction in work hours from the list enumerated in /voluntaryQuitReasonOptions. Selecting one of the 4.308.1 enumerated good-cause reasons indicates good cause; selecting Other or StrikingGovernmentEmployee indicates there is no good cause and — combined with /members/*/voluntarilyQuitOrReducedWorkEffort — drives the ineligible-voluntary-quit determination (10 CCR 2506-1, 4.308.1).

Allowed values: `discrimination` · `unreasonable_work_conditions` · `new_employment_or_schooling` · `household_move_for_job_or_schooling` · `recognized_retirement_under_sixty` · `unsuitable_employment` · `accepted_full_time_employment_did_not_materialize` · `patterns_of_employment` · `illness_of_head_of_household` · `illness_of_other_household_member` · `household_emergency` · `unavailable_transportation` · `employer_demands_reduction` · `lack_of_adequate_child_care` · `striking_government_employee` · `other`

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 68, 77, 78, 79

#### `members[].findings.qualityAssuranceNonCooperation`

`Boolean` · SNAP · direct · source: **state**

Whether this member has been disqualified for failure to cooperate with the state quality assurance division (10 CCR 2506-1, 4.000.1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 4, 8, 222

#### `members[].findings.felonyNonCompliance`

`Boolean` · SNAP · direct · source: **state**

Whether this member is a person with a felony conviction who is not in compliance with the terms of their sentence and was convicted as an adult for conduct that occurred after February 7, 2014 for any of the following crimes: aggravated sexual abuse under Section 2241 of Title 18, United States Code; murder under Section 1111 of Title 18, United States Code; an offense under Chapter 110 of Title 18, United States Code; a federal or state offense involving sexual assault, as defined in Section 40002(a) of the Violence Against Women Act of 1994 (42 U.S.C. 13925(a)); or an offense under state law determined by the attorney general to be substantially similar to the foregoing (10 CCR 2506-1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 51

#### `members[].findings.paroleOrProbationViolation`

`Boolean` · SNAP · direct · source: **state**

Whether this member is disqualified as a parole or probation violator. An impartial party designated by the agency must determine that the individual violated a condition of probation or parole imposed under federal or state law, and that federal, state, or local law enforcement authorities are actively seeking the individual to enforce those conditions. Active pursuit is established when a law enforcement agency informs the local office it intends to enforce an outstanding felony warrant or arrest the individual for a probation or parole violation within 20 days of submitting a request for information about the individual; presents a felony arrest warrant as provided in 4.304.4, B, 1; or states it intends to enforce an outstanding felony warrant or arrest the individual for a probation or parole violation within 30 days of the date of a request from a local office about a specific outstanding felony warrant or probation or parole violation (10 CCR 2506-1, 4.304.4)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 52

#### `members[].findings.isFleeingFelon`

`Boolean` · SNAP · direct · source: **state**

Whether this member is fleeing to avoid prosecution or custody for a crime, or an attempt to commit a crime, that would be classified as a felony under a state or federal law (10 CCR 2506-1, 4.000.1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 5, 51, 52

#### `members[].findings.sanctionImposed`

`Boolean` · SNAP · direct · source: **state**

Whether a specified period of ineligibility has been imposed against this member for failing to take a required action as part of his or her eligibility for SNAP (10 CCR 2506-1, 4.000.1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 7, 11, 79

## Member — other

#### `members[].receivesTanf`

`Boolean` · SNAP · direct · source: **either**

Whether this member receives a cash grant from the Temporary Assistance for Needy Families (TANF) or Colorado Works (CW) cash program, also known as Title IV-A of the Social Security Act (10 CCR 2506-1, 4.000.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 8, 12, 65

#### `members[].isEmancipated`

`Boolean` · SNAP · direct · source: **applicant**

Whether this member is a minor who has been emancipated as defined by state law. An emancipated minor is not considered to be under another household member's parental control for purposes of the mandatory-child SNAP household rule (10 CCR 2506-1, 4.304.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 47

#### `members[].isFosterChild`

`Boolean` · SNAP · direct · source: **either**

Whether this member is a foster child. Foster children are explicitly excluded from the rule requiring a child under eighteen (18) who lives under the parental control of a non-parent household member to be a mandatory household member (10 CCR 2506-1, 4.304.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 47

#### `members[].wasInFosterCareOn18thBirthday`

`Boolean` · SNAP · direct · source: **either**

Whether this member was in foster care on their eighteenth (18th) birthday for purposes of the ABAWD exemption for individuals aged twenty-four (24) years and younger (10 CCR 2506-1, 4.311.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 81

#### `members[].receivesFamilyPreservationServices`

`Boolean` · SNAP · direct · source: **either**

Whether this member receives services from the Family Preservation Program. This determination must be documented in the case record (10 CCR 2506-1, 4.206).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 34

## Income (members[].income[])

#### `members[].income[].type`

`Enum` · SNAP + Medicaid · derived · source: **applicant** · ✦ in the published worker-portal contract

The source/type of this income.

> *Adapter mapping:* employed/self_employed → earned; unearned → unearned. Medicaid sums all members' income to the household scalars, normalized to monthly.

Allowed values: 42 — see [Vocabularies](#vocabularies).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 8, 11, 12, 92

#### `members[].income[].unearnedType`

`Enum` · SNAP + Medicaid · derived · source: **applicant** · ✦ in the published worker-portal contract

The source/type of this income.

> *Adapter mapping:* Refines the SNAP income-source enum; ssi_or_ssdi also sets the medicaid SSI flag (note: ORCA conflates SSI with SSDI).

Allowed values: 42 — see [Vocabularies](#vocabularies).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 8, 11, 12, 92

#### `members[].income[].incomeBasis`

`—` · no program (see note) · compat · source: **applicant** · ✦ in the published worker-portal contract

> *Adapter mapping:* Carried for ORCA compatibility; the rules do not currently distinguish net vs gross at the income-row level.

#### `members[].income[].amount`

`Dollar` · SNAP + Medicaid · direct · source: **applicant** · ✦ in the published worker-portal contract

The average income amount for this income at its stated frequency.

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 69, 86, 87, 90, 91, 92, 93, 180

#### `members[].income[].frequency`

`Enum` · SNAP · direct · source: **applicant** · ✦ in the published worker-portal contract

How often this income amount is received or anticipated, used to convert the amount to a monthly amount (10 CCR 2506-1, 4.402).

Allowed values: `monthly` · `weekly` · `bi_weekly` · `semi_monthly` · `every_other_month` · `quarterly` · `twice_a_year` · `annual` · `other_specific_time_period`

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 85, 93

#### `members[].income[].payDate`

`Day` · SNAP · direct · source: **applicant**

The date this income was received or is expected to be received, used to test whether terminated-source income was received prior to the date of application and whether new-source income will be received within the applicable tenth-day destitute-income deadline (10 CCR 2506-1, 4.406, A, 1-3).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 106, 107

#### `members[].income[].monthsIntended`

`Int` · SNAP · direct · source: **applicant**

The number of months this income amount is intended to cover when the income is for another specific period of time; that income is divided by this number of months to obtain average monthly income (10 CCR 2506-1, 4.402.2).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 87

#### `members[].income[].receivedBeforeSnapParticipation`

`Boolean` · SNAP · direct · source: **state**

Whether this income source was received before SNAP participation for exclusions that depend on the income's timing relative to SNAP participation. VISTA payments and earned income tax credits count as income when this is true, and are excluded only when this is false (10 CCR 2506-1, 4.405.2, A, 3 and A, 20).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 88, 101

#### `members[].income[].isWorkSupplementation`

`Boolean` · SNAP · direct · source: **state**

Whether this income is the portion earned under a work supplementation or work support program that is attributable to a federal, state, or local public assistance program, so it is not eligible for the earned income deduction (10 CCR 2506-1, 4.407.2, B).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 108

#### `members[].income[].fromTerminatedSource`

`Boolean` · SNAP · direct · source: **applicant**

Whether this income source meets the terminated-source definition for destitute-of-income rules: income normally received monthly or more often that is not expected again from the same source during the remainder of the application month or the following month, or income normally received less often than monthly that is not anticipated in the month it would normally be received (10 CCR 2506-1, 4.406, A, 1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 106

#### `members[].income[].fromNewSource`

`Boolean` · SNAP · direct · source: **applicant**

Whether this income source meets the new-source definition for destitute-of-income rules: income normally received monthly or more often but not received from that source within thirty (30) calendar days before the application filing date, or income normally received less often than monthly but not received within the last normal interval between payments (10 CCR 2506-1, 4.406, A, 2).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 107

#### `members[].income[].excludedIncomeType`

`Enum` · SNAP · direct · source: **either**

The specific type of other federally excluded income under 10 CCR 2506-1, 4.405.2. Use when /incomes/*/type is Other and the payment matches one of the listed statutory exclusions; several option names include required qualifying facts such as age, program participation, disaster/emergency status, quarterly limits, deployment status, or tribal/statutory payment limits.

Allowed values: 53 — see [Vocabularies](#vocabularies).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 99, 100, 101, 102, 103, 104, 105, 106

#### `members[].income[].needBasedNonprofitCashDonationQuarterlyExclusionUsed`

`Dollar` · SNAP · direct · source: **state**

The amount of the three hundred dollar ($300) aggregate fiscal-quarter exclusion for need-based cash donations from private nonprofit charitable organizations that has already been used by other donations in the same fiscal quarter (10 CCR 2506-1, 4.405.2, A, 10).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 100

#### `members[].income[].indianTrustRestrictedLandInterestAnnualExclusionUsed`

`Dollar` · SNAP · direct · source: **state**

The amount of the two thousand dollar ($2,000) calendar-year exclusion for income derived from an individual Indian's interest in trust or restricted lands that has already been used by other such income in the same calendar year (10 CCR 2506-1, 4.405.2, B, 2).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 103

## Expenses (members[].expenses[])

#### `members[].expenses[].category`

`Enum` · SNAP · derived · source: **applicant** · ✦ in the published worker-portal contract

The type of household expense. Select ChildSupport for legally obligated child support, which is considered an income exclusion (10 CCR 2506-1, 4.405, D).

> *Adapter mapping:* Coarse ORCA category mapped to a representative rules type; supply detailType for precision.

Allowed values: 78 — see [Vocabularies](#vocabularies).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 108, 110, 111

#### `members[].expenses[].detailType`

`Enum` · SNAP · direct · source: **applicant**

The type of household expense. Select ChildSupport for legally obligated child support, which is considered an income exclusion (10 CCR 2506-1, 4.405, D).

> *Adapter mapping:* snake_case of the rules expense-type vocabulary (see Vocabularies below); overrides category.

Allowed values: 78 — see [Vocabularies](#vocabularies).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 108, 110, 111

#### `members[].expenses[].amount`

`Dollar` · SNAP · direct · source: **applicant** · ✦ in the published worker-portal contract

The expense amount at its stated frequency or, when the household does not elect averaging, the monthly expense amount.

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 69, 108

#### `members[].expenses[].frequency`

`Enum` · SNAP · direct · source: **applicant** · ✦ in the published worker-portal contract

How often this expense is billed or incurred. Weekly, bi-weekly, and semi-monthly expenses are converted to monthly amounts; other non-monthly frequencies are averaged only when the household elects to average the expense over the period it is intended to cover (10 CCR 2506-1, 4.407, B).

Allowed values: `monthly` · `weekly` · `bi_weekly` · `semi_monthly` · `every_other_month` · `quarterly` · `twice_a_year` · `annual` · `other_specific_time_period`

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 108, 146

#### `members[].expenses[].reimbursementAmount`

`Dollar` · SNAP · direct · source: **applicant**

The amount of this expense reimbursed or expected to be reimbursed from another source at the expense's stated frequency. Allowable medical costs are reduced by reimbursements from another source (10 CCR 2506-1, 4.407.6).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 113

#### `members[].expenses[].shouldAverage`

`Boolean` · SNAP · direct · source: **applicant**

Whether the household elects to average this fluctuating monthly expense or expense billed less often than monthly over the applicable period. This election controls optional averaging frequencies other than weekly, bi-weekly, and semi-monthly, which are converted to monthly amounts regardless of this election (10 CCR 2506-1, 4.407, B).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 108

#### `members[].expenses[].monthsIntended`

`Int` · SNAP · direct · source: **applicant**

The number of months this expense amount is intended to cover when the household elects to average an expense over a specific period not represented by another frequency option (10 CCR 2506-1, 4.407, B).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 108

#### `members[].expenses[].forWorkTrainingOrEducation`

`Boolean` · SNAP · direct · source: **applicant**

Whether this dependent care expense is necessary for a household member to accept or continue employment, seek employment, or attend training or pursue education that is preparatory to employment (10 CCR 2506-1, 4.407.4).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 112

#### `members[].expenses[].paidOutsideHousehold`

`Boolean` · SNAP · direct · source: **applicant**

Whether this dependent care expense is a direct monetary payment to an agency or a person outside of the household. Only direct monetary payments to an agency or a person outside the household are allowable for the dependent care deduction, and in-kind benefits paid to an attendant are not considered (10 CCR 2506-1, 4.407.4).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 113

#### `members[].expenses[].forClaimableShelterResidence`

`Boolean` · SNAP · direct · source: **applicant**

Whether this expense is for a residence whose shelter costs may be claimed by the household: either the household's actual residence, or a home not occupied by the household because of employment or training away from home, illness, natural disaster, or casualty loss where the household intends to return, current occupants are not claiming the shelter costs for SNAP, and the home is not leased or rented during the household's absence (10 CCR 2506-1, 4.407.3, D).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 109

#### `members[].expenses[].dependentCareMileage`

`Int` · SNAP · direct · source: **applicant**

The miles driven to and from the dependent care facility at this expense's stated frequency. Mileage expenses are calculated at the stated frequency by multiplying these miles by the dependent care mileage rate, then converted to a monthly amount using the expense frequency (10 CCR 2506-1, 4.407.4).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 113

#### `members[].expenses[].medicalMileage`

`Int` · SNAP · direct · source: **applicant**

The reasonable miles driven to obtain medical treatment or services at this expense's stated frequency. Mileage expenses are calculated at the stated frequency by multiplying these miles by the medical mileage rate, then converted to a monthly amount using the expense frequency (10 CCR 2506-1, 4.407.6).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 114

#### `members[].expenses[].utilityDetails.separateHeatingCoolingCosts`

`Boolean` · SNAP · direct · source: **applicant**

Whether this heating or cooling expense is incurred or anticipated separate and apart from the household's rent or mortgage (10 CCR 2506-1, 4.407.31).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 111

#### `members[].expenses[].utilityDetails.privateRentalBilledForHeatingCooling`

`Boolean` · SNAP · direct · source: **applicant**

Whether this heating or cooling expense is for private rental housing and is billed by the landlord on the basis of individual usage, or is charged as a flat rate separately from rent (10 CCR 2506-1, 4.407.31).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 111

#### `members[].expenses[].utilityDetails.sharedResidencePaysPortion`

`Boolean` · SNAP · direct · source: **applicant**

Whether this heating or cooling expense is for a shared residence where the household incurs at least a portion of the heating or cooling cost, entitling each household to the full Heating and Cooling Utility Allowance (HCUA) (10 CCR 2506-1, 4.407.31).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 111

#### `members[].expenses[].utilityDetails.publicHousingExcessCosts`

`Boolean` · SNAP · direct · source: **applicant**

Whether this heating or cooling expense is for public housing where the household is responsible for excess heating or cooling costs (10 CCR 2506-1, 4.407.31).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 111

## Assets (members[].assets[])

#### `members[].assets[].type`

`Enum` · SNAP · derived · source: **applicant** · ✦ in the published worker-portal contract

The type of household resource item, including liquid resources such as cash on hand, money in checking or savings accounts, saving certificates, stocks or bonds, and exempt resources identified in 10 CCR 2506-1, 4.410.

> *Adapter mapping:* Coarse ORCA type mapped to a representative rules type; supply detailType for precision.

Allowed values: 65 — see [Vocabularies](#vocabularies).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 69, 120, 121, 122, 123

#### `members[].assets[].detailType`

`Enum` · SNAP · direct · source: **applicant**

The type of household resource item, including liquid resources such as cash on hand, money in checking or savings accounts, saving certificates, stocks or bonds, and exempt resources identified in 10 CCR 2506-1, 4.410.

> *Adapter mapping:* snake_case of the rules resource-type vocabulary (see Vocabularies below); overrides type.

Allowed values: 65 — see [Vocabularies](#vocabularies).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 69, 120, 121, 122, 123

#### `members[].assets[].value`

`Dollar` · SNAP · direct · source: **applicant** · ✦ in the published worker-portal contract

The countable value of this resource item: for liquid resources, the current redemption rate less encumbrances; for non-liquid resources, the fair market value (or real property value) less verified encumbrances (10 CCR 2506-1, 4.408.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 69, 118, 119, 120

#### `members[].assets[].excludedResourceType`

`Enum` · SNAP · direct · source: **either**

The specific type of other government payment received for a specific purpose or services and excluded as a resource under 10 CCR 2506-1, 4.410, J. Use when /resourceItems/*/type is Other and the resource matches one of the listed statutory exclusions.

Allowed values: `child_nutrition_act_assistance` · `youth_incentive_entitlement_or_youth_community_conservation_or_youth_employment_training_payment` · `disaster_home_restoration_payment_with_legal_sanction` · `presidential_disaster_or_emergency_assistance` · `uniform_relocation_act_reimbursement` · `wic_benefit` · `federal_energy_assistance_weatherization_or_emergency_heating_cooling_payment` · `hud_rental_refund_payment` · `mandatory_military_education_deduction` · `japanese_american_or_aleut_civil_liberties_payment` · `wic_farmers_market_demonstration_project_benefit` · `agent_orange_settlement_fund_payment` · `earned_income_tax_credit` · `radiation_exposure_compensation_trust_fund_payment` · `nazi_persecution_victim_payment` · `crime_victim_compensation_payment` · `vietnam_veteran_child_spina_bifida_allowance` · `federal_income_tax_refund`

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 124, 125

## Employment (members[].employment[])

#### `members[].employment[].status`

`Boolean` · SNAP · derived · source: **applicant** · ✦ in the published worker-portal contract

Whether this job is self-employment. The work-requirement employment exemption applies to employed or self-employed individuals who meet the hours or weekly-earnings threshold (10 CCR 2506-1, 4.310).

> *Adapter mapping:* self_employed → true; other values → false.

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 65, 76, 90

#### `members[].employment[].hoursPerWeek`

`Int` · SNAP + Medicaid · derived · source: **applicant** · ✦ in the published worker-portal contract

The average number of hours per week worked in this job. Employed or self-employed individuals may be exempt from SNAP work requirements when they work at least thirty (30) hours per week (10 CCR 2506-1, 4.310).

> *Adapter mapping:* Medicaid monthly hours = sum of hoursPerWeek × 52/12 across jobs.

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 65, 76

#### `members[].employment[].abawdWorkType`

`Enum` · SNAP · direct · source: **either**

The type of work performed in this job for ABAWD work-requirement purposes. Compensated work, in-kind work, and unpaid work verified by the provider of the unpaid work count toward ABAWD work hours (10 CCR 2506-1, 4.000.1).

Allowed values: `compensated_work` · `in_kind_work` · `verified_unpaid_work` · `other`

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 80

#### `members[].employment[].isAtFederalMinimumWage`

`Boolean` · SNAP · direct · source: **applicant**

Whether this job is paid at least the federal minimum wage for the hours worked. For self-employment, this means earnings after allowable business expenses are deducted are at least equal to the federal minimum wage for the hours worked. Used to add up hours that count toward the student self-employment wage requirement and the work-requirement employment earnings threshold (10 CCR 2506-1, 4.306.1, B; 4.310).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 65, 76

#### `members[].employment[].isOnTheJobTraining`

`Boolean` · SNAP · direct · source: **applicant**

Whether this job is on-the-job training (OJT), meaning training provided to an employee after they are hired and designed for individuals who do not have the necessary work experience required for the job (10 CCR 2506-1, 4.000.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 8

#### `members[].employment[].goodCause.wagesBelowApplicableMinimum`

`Boolean` · SNAP · direct · source: **applicant**

Whether the wages offered for this employment are less than the higher of the applicable federal or state minimum wage, or less than eighty percent (80%) of the federal minimum wage if neither the federal nor state minimum wage is applicable (10 CCR 2506-1, 4.310.7).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 77

#### `members[].employment[].goodCause.pieceRateYieldBelowApplicableWage`

`Boolean` · SNAP · direct · source: **applicant**

Whether this employment is offered on a piece-rate basis and the average hourly yield the employee can reasonably be expected to earn is less than the applicable hourly wage for suitable employment (10 CCR 2506-1, 4.310.7).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 77

#### `members[].employment[].goodCause.requiresLaborOrganizationAction`

`Boolean` · SNAP · direct · source: **applicant**

Whether the member is required, as a condition of this employment, to join, resign from, or refrain from joining any legitimate labor organization (10 CCR 2506-1, 4.310.7).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 77

#### `members[].employment[].goodCause.worksiteSubjectToStrikeOrLockout`

`Boolean` · SNAP · direct · source: **applicant**

Whether this employment is at a site subject to a strike or lockout at the time of the offer, unless the strike has been enjoined under the Labor Management Relations Act or Railway Labor Act (10 CCR 2506-1, 4.310.7).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 77

#### `members[].employment[].goodCause.unreasonableHealthSafetyRisk`

`Boolean` · SNAP · direct · source: **applicant**

Whether the member can demonstrate, or the local office becomes aware, that this employment presents an unreasonable degree of risk to health and safety (10 CCR 2506-1, 4.310.7).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 77

#### `members[].employment[].goodCause.physicallyOrMentallyUnfit`

`Boolean` · SNAP · direct · source: **applicant**

Whether the member is physically or mentally unfit to perform this employment, as established by documentary medical evidence or reliable information obtained from other sources (10 CCR 2506-1, 4.310.7).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 77

#### `members[].employment[].goodCause.outsideMajorFieldDuringInitialThirtyDays`

`Boolean` · SNAP · direct · source: **applicant**

Whether this employment is not in the member's major field of experience and job opportunities in that major field have not failed to be offered after thirty (30) calendar days from registration (10 CCR 2506-1, 4.310.7).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 78

#### `members[].employment[].goodCause.unreasonableDistance`

`Boolean` · SNAP · direct · source: **applicant**

Whether the distance from the member's home to the place of employment is unreasonable considering the expected wage and the time and cost of commuting (10 CCR 2506-1, 4.310.7).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 78

#### `members[].employment[].goodCause.dailyCommuteExceedsTwoHours`

`Boolean` · SNAP · direct · source: **applicant**

Whether the daily commuting time for this employment exceeds two (2) hours per day, not including the time needed to transport a child or children to and from a child care facility (10 CCR 2506-1, 4.310.7).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 78

#### `members[].employment[].goodCause.noTransportationForNonWalkingDistance`

`Boolean` · SNAP · direct · source: **applicant**

Whether the distance to the place of employment prohibits walking and neither public nor private transportation is available to transport the member to the job site (10 CCR 2506-1, 4.310.7).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 78

#### `members[].employment[].goodCause.interferesWithReligiousObservance`

`Boolean` · SNAP · direct · source: **applicant**

Whether the working hours or nature of this employment interferes with the member's religious observances, convictions, or beliefs (10 CCR 2506-1, 4.310.7).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 78

#### `members[].employment[].goodCause.offerAccepted`

`Boolean` · SNAP · direct · source: **applicant**

Whether the member accepted this offered job.

## Household

#### `household.size`

`—` · Medicaid · derived · source: **applicant** · ✦ in the published worker-portal contract

Number of members in the household.

> *Adapter mapping:* Medicaid derives household size from the members list (+ expected children); SNAP composes its own household unit from member facts. Supplied size is used as a cross-check.

#### `household.housingCosts`

`—` · no program (see note) · compat · source: **applicant** · ✦ in the published worker-portal contract

> *Adapter mapping:* Coarse ORCA field; prefer per-member expenses[] with category housing, which is what the rules consume.

#### `household.utilityCosts`

`—` · no program (see note) · compat · source: **applicant** · ✦ in the published worker-portal contract

> *Adapter mapping:* Coarse ORCA field; prefer per-member expenses[] with category utilities / a utility detailType.

#### `household.isMigrantOrSeasonalFarmWorker`

`Boolean` · SNAP · derived · source: **applicant** · ✦ in the published worker-portal contract

Whether this member travels away from home on a regular basis to follow the flow of seasonal agricultural work (10 CCR 2506-1, 4.000.1)

> *Adapter mapping:* Household-level ORCA flag; the rules evaluate migrant status per member — prefer workRequirements.isMigrantFarmWorker.

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 7

#### `household.expectsShelterCosts`

`Boolean` · SNAP · direct · source: **applicant**

Whether the household incurs, or reasonably expects to incur, shelter costs during the month. Households experiencing homelessness that incur no shelter costs during the month are not eligible for the homeless shelter deduction estimate (10 CCR 2506-1, 4.407.3, C).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 109

#### `household.previousSubstantialLotteryWinnings`

`Boolean` · SNAP · direct · source: **either**

Whether the SNAP household previously lost eligibility because a member received substantial lottery or gambling winnings. The next time such a household reapplies and is certified for SNAP after losing eligibility, the household must be considered under Standard Eligibility (SE) guidelines; after receiving SNAP as an SE household, the household will be re-evaluated for categorical eligibility at the next eligible certification period (10 CCR 2506-1, 4.206).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 37

#### `household.participatesInCommodityFoodProgram`

`Boolean` · SNAP · direct · source: **either**

Whether the household is on an Indian reservation and participating in the Commodity Food Distribution Program for the current period. Participation must be limited to either the Commodity Food Distribution Program or SNAP, not both (10 CCR 2506-1, 4.304.4).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 46

#### `household.receivesEnergyAssistance`

`Boolean` · SNAP · direct · source: **state**

Whether the household received a Low-Income Energy Assistance Program (LEAP) payment within the previous twelve (12) month period, which qualifies the household for the Heating and Cooling Utility Allowance (HCUA) (10 CCR 2506-1, 4.407.31).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 7, 111

#### `household.receivedEmergencyBenefits`

`Boolean` · SNAP · direct · source: **state**

Whether the household received an Energy Electronic Benefit Transfer (E-EBT) payment within the previous twelve (12) month period, which qualifies the household for the Heating and Cooling Utility Allowance (HCUA) (10 CCR 2506-1, 4.407.31).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 4, 111

## Caregiver relationships (household.caregiverRelationships[])

#### `household.caregiverRelationships[].caregiverId`

`reference` · SNAP · structural

The household member who is either a natural, adoptive, or stepparent in this relationship, or a non-parent household member exercising parental control over the child. When the relationship is a natural, adoptive, or stepparent relationship to a child aged twenty-one (21) years or younger living in the same home, this member must be included in the SNAP household (10 CCR 2506-1, 4.304.1).

> *Adapter mapping:* Reference to a member id.

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 47

#### `household.caregiverRelationships[].dependentId`

`reference` · SNAP · structural

The household member who is the child or dependent in this caregiver relationship — either the natural, adoptive, or stepchild of the caregiver, or a child under the parental control of a non-parent household member (10 CCR 2506-1, 4.304.1).

> *Adapter mapping:* Reference to a member id.

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 47

#### `household.caregiverRelationships[].isParent`

`Boolean` · SNAP · direct · source: **applicant**

Whether the caregiver-side member is the child's natural, adoptive, or stepparent, rather than a non-parent household member exercising parental control over the child. A child under eighteen (18) is considered to be under parental control of a household member when financially or otherwise dependent on that member (10 CCR 2506-1, 4.304.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 47

#### `household.caregiverRelationships[].isNonparentParentalControl`

`Boolean` · SNAP · direct · source: **applicant**

Whether this caregiver relationship is the non-parent parental-control kind: the dependent-side member is a child under the parental control of a caregiver-side member who is not the child's natural, adoptive, or stepparent. A child under eighteen (18) is considered to be under parental control of a household member when financially or otherwise dependent on that member (10 CCR 2506-1, 4.304.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 47

#### `household.caregiverRelationships[].providesMostOfCare`

`Boolean` · SNAP · direct · source: **applicant**

Whether the caregiver-side member in this relationship is responsible for more than half of the physical care of the child. Used by the SNAP student-eligibility exemption for a student responsible for the physical care of a dependent household member aged six (6) to under twelve (12) (10 CCR 2506-1, 4.306.1, E).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 65

#### `household.caregiverRelationships[].adequateChildcareUnavailable`

`Boolean` · SNAP · direct · source: **applicant**

Whether the local office has determined that adequate childcare is not available for the dependent-side member in this relationship to enable the caregiver-side member to attend class and satisfy the requirement of item B or item C of 4.306.1 (10 CCR 2506-1, 4.306.1, E).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 65

#### `household.caregiverRelationships[].claimedForWorkExemption`

`Boolean` · SNAP · direct · source: **applicant**

Whether this caregiver relationship is the one claimed for the SNAP work-requirements exemption for a parent or other household member responsible for the care of this dependent child under six (6) or incapacitated person. This per-relationship flag identifies which caregiver claims the exemption when multiple caregivers are associated with the same dependent (10 CCR 2506-1, 4.310).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 75

## Application context

#### `applicationContext.filingDate`

`Day` · SNAP · direct · source: **either**

The date an application for public assistance is received by the county office, used as the application date for destitute-of-income timing (10 CCR 2506-1, 4.000.1; 4.406)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 1, 106

#### `applicationContext.benefitMonth`

`Day` · SNAP · direct · source: **state**

The specific calendar month for which the engine is currently calculating benefits and eligibility, used to determine whether the household is in the first month of the certification period for destitute-of-income treatment (10 CCR 2506-1, 4.406).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 7, 106

#### `applicationContext.certificationPeriodStartDate`

`Day` · SNAP · direct · source: **state**

The official first day of the household's approved initial certification or recertification period, used to determine whether the benefit month is the first month of the certification period for destitute-of-income treatment (10 CCR 2506-1, 4.406).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 106

#### `applicationContext.isRecertification`

`Boolean` · SNAP · direct · source: **state**

Whether this application was submitted prior to the last month of the certification period to determine the household's continued eligibility for the next certification period (10 CCR 2506-1, 4.000.1)

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 1

#### `applicationContext.receivedSnapInLast30Days`

`Boolean` · SNAP · direct · source: **state**

Whether the household received SNAP benefits within the thirty (30) days preceding the current application. Used to determine whether a migrant or seasonal farm worker household's break in participation does not exceed thirty (30) days, which exempts the household from initial-month allotment proration (10 CCR 2506-1, 4.207.2).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 38

#### `applicationContext.normalIssuanceCycleDate`

`Day` · SNAP · direct · source: **state**

The household's normal issuance cycle date, used for recertification applications when determining whether new-source income will be received by the tenth (10th) calendar day after that normal issuance cycle for destitute-of-income treatment (10 CCR 2506-1, 4.406, A, 2-3).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 107

#### `applicationContext.livesInApplicationCounty`

`Boolean` · SNAP · direct · source: **state**

Whether the household lives in the county or district in which they make application for the Program (10 CCR 2506-1, 4.303).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 46

#### `applicationContext.hasNearbyCountyArrangement`

`Boolean` · SNAP · direct · source: **state**

Whether the local office has made arrangements to allow this household to file an application in a nearby specified county/district office (10 CCR 2506-1, 4.303).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 46

#### `applicationContext.disasterDeclarationActive`

`Boolean` · SNAP · direct · source: **state**

Whether there is a major disaster or emergency declared by the President. Disaster or emergency assistance is excluded under 10 CCR 2506-1, 4.405.2 only when precipitated by an emergency or major disaster as defined in the Disaster Relief Act; FEMA-funded homeless rent, mortgage, food, or utility assistance when there is no major disaster or emergency is not excluded under this provision.

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — p. 100

#### `applicationContext.dSnapActive`

`Boolean` · SNAP · direct · source: **state**

Whether the Disaster Supplemental Nutrition Assistance Program (D-SNAP) is active for the affected county, following a Presidential disaster declaration for individual assistance and at the county's discretion in coordination with the state SNAP office and FNS (10 CCR 2506-1, 4.000.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 3, 223, 224

#### `applicationContext.temporaryEmergencyActive`

`Boolean` · SNAP · direct · source: **state**

Whether a temporary emergency is active — an emergency caused by any natural or human-caused disaster, other than a major disaster declared by the President of the United States under the Disaster Relief Act of 1974, which is determined by FNS to have disrupted commercial channels of food distribution (10 CCR 2506-1, 4.000.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 12, 223, 224

#### `applicationContext.inadvertentHouseholdErrorClaim`

`Boolean` · SNAP · direct · source: **state**

Whether an Inadvertent Household Error (IHE) claim is due to earned income being reported in an untimely manner, so the claim is calculated without allowing the twenty percent (20%) earned income deduction (10 CCR 2506-1, 4.000.1).

Policy: 10 CCR 2506-1 — Colorado SNAP Rules — pp. 6, 109, 177, 180

## Candidate worker-portal contract additions

Fields that pass the realistic-source test for the portal — `applicant`
or `either` origin — and are **not** in the published worker-portal
contract today. Generated from the Source classification above; offered
as the starting list for the contract conversation (which of these the
portal application should actually ask is a Worker Portal / State
workflow decision). Fields classified `state` belong at the
rules-engine boundary (the v2 contract), supplied by the systems that
hold case records and data-exchange results — not by the portal.

- **Member — pregnancy**: `members[].pregnancy.isPregnant`, `members[].pregnancy.expectedChildren`, `members[].pregnancy.endDate`
- **Member — veteran status**: `members[].veteranStatus.isVeteran`, `members[].veteranStatus.hasDisability`, `members[].veteranStatus.needsAidAndAttendance`, `members[].veteranStatus.survivorNeedsAidAndAttendance`, `members[].veteranStatus.survivorHasDisability`
- **Member — student status**: `members[].studentStatus.enrollment`, `members[].studentStatus.inK12`, `members[].studentStatus.inWorkStudy`, `members[].studentStatus.assignedByEmploymentTrainingProgram`, `members[].studentStatus.unfitForEmployment`
- **Member — disability details**: `members[].disabilityDetails.types`, `members[].disabilityDetails.isIncapacitated`, `members[].disabilityDetails.unableToPrepareMeals`, `members[].disabilityDetails.receivesDisabilityBenefits`, `members[].disabilityDetails.receivesPublicDisabilityPension`, `members[].disabilityDetails.receivesRailroadRetirementDisability`, `members[].disabilityDetails.receivesInterimAssistance`, `members[].disabilityDetails.ssiApplicationPending`, `members[].disabilityDetails.inVocationalRehabilitation`, `members[].disabilityDetails.hasDisabledChild`
- **Member — living situation**: `members[].livingSituation.settings`, `members[].livingSituation.isExperiencingHomelessness`, `members[].livingSituation.isBoarder`, `members[].livingSituation.isRoomer`, `members[].livingSituation.isLiveInAttendant`, `members[].livingSituation.isSeparateAndApart`, `members[].livingSituation.preparesFoodWithHousehold`, `members[].livingSituation.recentlyReleasedFromInstitution`, `members[].livingSituation.participatesInAnotherHousehold`
- **Member — work requirements**: `members[].workRequirements.inEmploymentTrainingProgram`, `members[].workRequirements.appliedForOrReceivingUnemployment`, `members[].workRequirements.inDrugOrAlcoholTreatment`, `members[].workRequirements.abawdWorkProgramHoursPerWeek`, `members[].workRequirements.unableToMaintainEmployment`, `members[].workRequirements.impactedByDomesticViolence`, `members[].workRequirements.temporaryConditionPreventsWork`, `members[].workRequirements.otherUnfitnessReason`, `members[].workRequirements.isMigrantFarmWorker`, `members[].workRequirements.striker.isStriker`, `members[].workRequirements.striker.eligibleDayBeforeStrike`, `members[].workRequirements.striker.exemptFromRegistrationDayBeforeStrike`
- **Member — immigration details**: `members[].immigrationDetails.qualifiedYearsInUs`, `members[].immigrationDetails.qualifyingWorkQuarters`, `members[].immigrationDetails.lawfullyResidedSince1996Senior`, `members[].immigrationDetails.qualifyingMilitaryConnection`, `members[].immigrationDetails.sponsor.isOrganization`, `members[].immigrationDetails.sponsor.dependentCount`, `members[].immigrationDetails.sponsor.otherSponsoredNonCitizens`
- **Member — other**: `members[].receivesTanf`, `members[].isEmancipated`, `members[].isFosterChild`, `members[].wasInFosterCareOn18thBirthday`, `members[].receivesFamilyPreservationServices`
- **Income (members[].income[])**: `members[].income[].payDate`, `members[].income[].monthsIntended`, `members[].income[].fromTerminatedSource`, `members[].income[].fromNewSource`, `members[].income[].excludedIncomeType`
- **Expenses (members[].expenses[])**: `members[].expenses[].detailType`, `members[].expenses[].reimbursementAmount`, `members[].expenses[].shouldAverage`, `members[].expenses[].monthsIntended`, `members[].expenses[].forWorkTrainingOrEducation`, `members[].expenses[].paidOutsideHousehold`, `members[].expenses[].forClaimableShelterResidence`, `members[].expenses[].dependentCareMileage`, `members[].expenses[].medicalMileage`, `members[].expenses[].utilityDetails.separateHeatingCoolingCosts`, `members[].expenses[].utilityDetails.privateRentalBilledForHeatingCooling`, `members[].expenses[].utilityDetails.sharedResidencePaysPortion`, `members[].expenses[].utilityDetails.publicHousingExcessCosts`
- **Assets (members[].assets[])**: `members[].assets[].detailType`, `members[].assets[].excludedResourceType`
- **Employment (members[].employment[])**: `members[].employment[].abawdWorkType`, `members[].employment[].isAtFederalMinimumWage`, `members[].employment[].isOnTheJobTraining`, `members[].employment[].goodCause.wagesBelowApplicableMinimum`, `members[].employment[].goodCause.pieceRateYieldBelowApplicableWage`, `members[].employment[].goodCause.requiresLaborOrganizationAction`, `members[].employment[].goodCause.worksiteSubjectToStrikeOrLockout`, `members[].employment[].goodCause.unreasonableHealthSafetyRisk`, `members[].employment[].goodCause.physicallyOrMentallyUnfit`, `members[].employment[].goodCause.outsideMajorFieldDuringInitialThirtyDays`, `members[].employment[].goodCause.unreasonableDistance`, `members[].employment[].goodCause.dailyCommuteExceedsTwoHours`, `members[].employment[].goodCause.noTransportationForNonWalkingDistance`, `members[].employment[].goodCause.interferesWithReligiousObservance`, `members[].employment[].goodCause.offerAccepted`
- **Household**: `household.expectsShelterCosts`, `household.previousSubstantialLotteryWinnings`, `household.participatesInCommodityFoodProgram`
- **Caregiver relationships (household.caregiverRelationships[])**: `household.caregiverRelationships[].isParent`, `household.caregiverRelationships[].isNonparentParentalControl`, `household.caregiverRelationships[].providesMostOfCare`, `household.caregiverRelationships[].adequateChildcareUnavailable`, `household.caregiverRelationships[].claimedForWorkExemption`
- **Application context**: `applicationContext.filingDate`

Totals across mapped value fields: 105 applicant-attestable, 13 either, 36 state-systems-only.

## Vocabularies

Full value sets for the open-string `detailType`-style fields. Values are
the snake_case form the API accepts; each maps 1:1 onto the rules
vocabulary.

### Expense detail types (`members[].expenses[].detailType`)

The type of household expense. Select ChildSupport for legally obligated child support, which is considered an income exclusion (10 CCR 2506-1, 4.405, D).

`child_support` · `dependent_care_provider_or_facility` · `dependent_care_transportation` · `dependent_care_activity_or_other_fees` · `rent` · `mortgage` · `condo_fees` · `association_fees` · `mobile_home_purchase_loan_repayment` · `reverse_mortgage_repayment` · `second_mortgage_or_home_equity_loan_payment` · `property_taxes` · `state_and_local_assessments` · `structure_insurance` · `natural_disaster_repair_or_rebuild` · `heating_fuel` · `cooling_costs` · `space_heater` · `electric_blanket` · `heat_lamp` · `cooking_stove_used_for_heat` · `electricity` · `cooking_fuel` · `water` · `sewer` · `well_installation_or_maintenance` · `septic_tank_installation_or_maintenance` · `garbage_or_trash_collection` · `utility_initial_installation_fee` · `landline_telephone_service` · `cellular_telephone_service` · `disposable_cell_phone_service` · `voice_over_internet_protocol_service` · `pet_expense_billed_separately_from_rent` · `unsecured_or_personal_loan_payment` · `furniture_or_personal_belongings_insurance` · `pay_phone` · `phone_card_not_associated_with_specific_device` · `one_time_deposit` · `internet_connectivity_fee` · `cable_or_internet_fee` · `medical_dental_care` · `psychotherapy_rehabilitation_services` · `hospitalization_outpatient_treatment` · `nursing_care` · `nursing_home_care` · `prescription_drug` · `practitioner_approved_over_the_counter_medication` · `medical_supplies` · `sickroom_equipment` · `prescribed_medical_equipment` · `health_hospitalization_insurance_premium` · `medicare_premium` · `medical_cost_sharing_expense` · `dentures` · `hearing_aids` · `prosthetics` · `eyeglasses` · `service_animal` · `medical_transportation` · `medical_lodging` · `attendant_care` · `homemaker` · `home_health_aide` · `medical_child_care_services` · `medical_housekeeper` · `attendant_meal_allowance` · `special_diet_expense` · `health_accident_policy_premium` · `income_maintenance_policy_premium` · `reimbursable_medical_expense` · `medical_marijuana` · `vitamins_or_supplements_not_prescribed` · `past_billing_period_medical_expense` · `past_medical_expense_pending_reimbursement_information` · `past_medical_expense_renegotiated_installment_plan` · `pure_ssi_household_past_medical_expense` · `previously_unreported_medical_expense`

### Resource (asset) detail types (`members[].assets[].detailType`)

The type of household resource item, including liquid resources such as cash on hand, money in checking or savings accounts, saving certificates, stocks or bonds, and exempt resources identified in 10 CCR 2506-1, 4.410.

`cash_on_hand` · `checking_account` · `savings_account` · `saving_certificate` · `stocks` · `bonds` · `automobile` · `motorcycle` · `vehicle` · `recreational_vehicle` · `seasonal_vehicle` · `home_and_surrounding_property` · `future_home_property` · `prorated_income` · `prorated_student_income` · `prorated_self_employment_income` · `household_goods` · `personal_effects` · `burial_plot` · `life_insurance_cash_value` · `livestock` · `federal_tax_preferred_retirement_account` · `pension_or_defined_benefit_plan` · `traditional_defined_benefit_plan` · `traditional_401k_plan` · `simple_401k_plan` · `section_501c_18_plan` · `section_403a_plan` · `section_403b_plan` · `section_408_plan` · `traditional_ira` · `roth_ira` · `simple_ira` · `my_ra` · `traditional_individual_retirement_annuity` · `section_457_plan` · `federal_employee_thrift_savings_plan` · `keogh_plan` · `section_529a_able_program_funds` · `simplified_employer_plan` · `profit_sharing_plan` · `cash_balance_plan` · `tax_deferred_education_account` · `section_529_qualified_tuition_program` · `coverdell_education_savings_account` · `pre_purchased_funeral_agreement` · `income_producing_property` · `farmland` · `rental_home` · `work_related_equipment` · `tools_of_tradesman` · `farm_machinery` · `income_producing_vehicle` · `installment_contract_producing_fair_market_income` · `former_farming_self_employment_essential_property` · `inaccessible_resource` · `irrevocable_trust_fund` · `property_in_probate` · `property_prohibited_from_sale_by_creditor_lien` · `real_property_good_faith_effort_to_sell` · `non_liquid_resource_net_return_1500_or_less` · `qualifying_trust_funds` · `no_significant_return_resource` · `battered_shelter_resident_inaccessible_resource` · `other`

### Income source types (`members[].income[].unearnedType (refines)`)

The source/type of this income.

`tanf` · `other_needs_based_assistance` · `old_age_pension` · `aid_to_needy_disabled` · `aid_to_blind` · `colorado_supplement_ssi` · `ssi` · `annuities_pensions_retirement` · `veterans_benefits` · `disability_benefits` · `workers_compensation` · `unemployment_compensation` · `old_age_survivors_social_security_benefits` · `strike_benefits` · `support_and_alimony` · `rental_income_not_actively_managed` · `post_employment_vacation_sick_bonus_pay` · `anticipated_gifts` · `wages_and_salaries` · `agricultural_stabilization_conservation_service` · `self_employment` · `vista` · `sick_leave_vacation_bonus_pay` · `vocational_rehabilitation_training_allowance` · `wioa_on_the_job_training` · `title_i_vista_university_year_of_action` · `llc_s_corporation` · `boarder_income` · `lottery_or_gambling_winnings` · `vendor_payments` · `irregular_income` · `non_household_member_care_payments` · `recoupments` · `title_ivd_transferred_child_support` · `non_recurring_lump_sum` · `loans` · `reverse_annuity_mortgage` · `in_kind_benefits` · `reimbursements` · `educational_assistance` · `sponsor_payments` · `other`

### Excluded income types (`members[].income[].excludedIncomeType`)

The specific type of other federally excluded income under 10 CCR 2506-1, 4.405.2. Use when /incomes/*/type is Other and the payment matches one of the listed statutory exclusions; several option names include required qualifying facts such as age, program participation, disaster/emergency status, quarterly limits, deployment status, or tribal/statutory payment limits.

`child_nutrition_act_assistance` · `uniform_relocation_act_reimbursement` · `domestic_volunteer_services_title_ii_payment` · `national_community_service_act_payment` · `presidential_disaster_or_emergency_assistance` · `wioa_payment_not_on_the_job_training` · `wioa_summer_youth_employment_training_payment` · `federal_energy_assistance_weatherization_or_emergency_heating_cooling_payment` · `youth_incentive_or_ceta_title_iv_payment` · `older_americans_act_title_v_age_55_or_older_payment` · `need_based_nonprofit_cash_donation` · `military_retirement_payment_to_ex_spouse_by_divorce_decree` · `military_combat_additional_pay_during_designated_combat_zone_deployment` · `mandatory_military_education_deduction` · `japanese_american_or_aleut_civil_liberties_payment` · `migrant_seasonal_farmworker_emergency_assistance` · `wic_benefit` · `title_iv_a_child_care_payment` · `agent_orange_settlement_fund_payment` · `at_risk_block_grant_child_care_payment` · `earned_income_tax_credit` · `employment_first_participation_cost_payment` · `pass_plan_amount` · `radiation_exposure_compensation_trust_fund_payment` · `child_care_development_block_grant_care_payment_or_service` · `public_housing_family_investment_center_service` · `hud_demonstration_project_earned_income_increase` · `nazi_persecution_victim_payment` · `crime_victim_compensation_payment` · `vietnam_veteran_child_spina_bifida_allowance` · `alaska_native_claims_settlement_act_payment` · `indian_judgment_or_trust_per_capita_payment` · `indian_trust_restricted_land_interest` · `navajo_hopi_relocation_assistance_payment` · `indian_submarginal_land_income_for_listed_tribe` · `sac_and_fox_per_capita_or_trust_fund_payment` · `grand_river_band_ottawa_payment` · `yakima_or_mescalero_apache_claims_payment` · `maine_indian_claims_settlement_payment` · `turtle_mountain_band_chippewas_payment` · `blackfeet_grosventre_assiniboine_or_papago_payment` · `red_lake_band_chippewa_payment` · `assiniboine_fort_belknap_or_fort_peck_payment` · `old_age_assistance_claims_settlement_heir_payment` · `chippewas_of_lake_superior_payment` · `white_earth_reservation_land_settlement_payment` · `saginaw_chippewa_indian_tribe_payment` · `chippewas_of_mississippi_payment` · `puyallup_tribe_settlement_payment` · `seminole_indian_claims_payment` · `seneca_nation_settlement_payment` · `colville_reservation_grand_coulee_dam_settlement_payment` · `migrant_farm_worker_employer_relocation_travel_advance_reimbursement`

### Excluded resource types (`members[].assets[].excludedResourceType`)

The specific type of other government payment received for a specific purpose or services and excluded as a resource under 10 CCR 2506-1, 4.410, J. Use when /resourceItems/*/type is Other and the resource matches one of the listed statutory exclusions.

`child_nutrition_act_assistance` · `youth_incentive_entitlement_or_youth_community_conservation_or_youth_employment_training_payment` · `disaster_home_restoration_payment_with_legal_sanction` · `presidential_disaster_or_emergency_assistance` · `uniform_relocation_act_reimbursement` · `wic_benefit` · `federal_energy_assistance_weatherization_or_emergency_heating_cooling_payment` · `hud_rental_refund_payment` · `mandatory_military_education_deduction` · `japanese_american_or_aleut_civil_liberties_payment` · `wic_farmers_market_demonstration_project_benefit` · `agent_orange_settlement_fund_payment` · `earned_income_tax_credit` · `radiation_exposure_compensation_trust_fund_payment` · `nazi_persecution_victim_payment` · `crime_victim_compensation_payment` · `vietnam_veteran_child_spina_bifida_allowance` · `federal_income_tax_refund`

## Getting started — what to send

The only schema-required fields are `program`, `household`, and per
member `id` + `dateOfBirth`. Practical starting sets:

- **Medicaid**: demographics (`dateOfBirth`, citizenship/immigration),
  `income[]`, and where applicable `pregnancy`, `disabilityDetails`,
  `studentStatus.enrollment`, `employment[].hoursPerWeek`. The graph
  needs only ~13 facts.
- **SNAP**: the medicaid set plus `expenses[]`, `assets[]`,
  `employment[]` detail, `livingSituation`, `workRequirements`, and —
  for a final (non-`pending`) determination — the `findings` block once
  verification completes.

From there, drive intake off the response: every `pending` decision
returns `missingInformation` listing exactly which of these fields are
still needed *for this case* — correct even when the rules short-circuit
(e.g. categorically-eligible SNAP households are never asked for assets).
