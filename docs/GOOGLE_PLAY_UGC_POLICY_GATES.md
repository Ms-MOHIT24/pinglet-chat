# Google Play user-generated content and social-safety review

**Status:** Engineering review aid only. This is not a legal opinion, policy certification, or evidence that Pinglet currently complies. The responsible adult operator must verify the current Play Console requirements and obtain appropriate review before release.

## Why this matters to Pinglet

Pinglet includes user-to-user messaging, voice messages, friend invitations, and voice/video rooms. These are social and user-generated-content features. A report endpoint and a block button are useful product controls, but they do not by themselves establish the ongoing moderation operation required for a public release.

## Required operator evidence before submission

- [ ] Users accept clear Terms of Use before creating or sharing user-generated content.
- [ ] Users can report both objectionable content and accounts from the relevant in-app surfaces.
- [ ] Users can block other users in one-to-one interactions, and the block is enforced consistently across messaging and invitations.
- [ ] A staffed, ongoing moderation process exists: named responsible operator and reviewers, monitored intake, review coverage, escalation rules, documented actions, and a way to contact the operator.
- [ ] Reports are triaged and addressed in a timely, consistent way; the service is not relying on an unattended queue.
- [ ] Moderators have least-privilege access, access is protected, and evidence retention/deletion rules are documented.
- [ ] The operator has tested the complete report → review → action → follow-up process using synthetic test accounts and content.
- [ ] The public child-safety contact and other required support details are monitored by the responsible operator.
- [ ] Store listing, content-rating answers, target-audience declarations, Data safety answers, and privacy disclosures accurately describe the shipped app and its actual operations.

## Target-audience decision

The responsible operator must choose the app's intended age groups based on the actual product, design, marketing, and applicable law—not merely to avoid a policy requirement.

If children are included in the target audience, Google's Families requirements for social apps/features may apply. These include an in-app online-safety reminder before children exchange freeform content or information, adult action before children exchange personal information, and adult management of social features. Google's policy also says social apps whose main focus is chatting with people users do not know or anonymous chat must not target children. Pinglet's friend-code model does not remove the need for a careful audience and safety review.

Do not enable a child audience declaration or invite child users until the responsible adult operator has verified that all applicable requirements are met. Do not encourage users to falsify their age.

## Current Pinglet evidence to verify

The repository describes report/block controls and a protected moderation API. The release checklist currently records that a staffed moderation operation and monitored public safety contact have not been verified. Treat those as release blockers until the operator supplies real operational evidence.

The repository also describes experimental, unaudited message encryption. Do not describe Pinglet as independently audited, identity-verified, or as providing audited end-to-end encryption.

## Official policy references

Check the live policy text again immediately before submission; Google may update it.

- [Google Play — User Generated Content](https://support.google.com/googleplay/android-developer/answer/9876937/)
- [Google Play — Developer Program Policy](https://support.google.com/googleplay/android-developer/answer/18265346)
- [Google Play — Families policies](https://support.google.com/googleplay/android-developer/answer/9893335)
- [Google Play — Testing requirements for new personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465)

## Release decision

A green CI run, a functioning report API, or a completed store listing does not prove ongoing moderation or policy compliance. Do not submit until the responsible adult operator has reviewed the current policies, completed the operational checks above, and approved the exact release candidate.
