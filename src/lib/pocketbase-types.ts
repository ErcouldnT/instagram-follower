/**
* This file was @generated using pocketbase-typegen
*/

export enum Collections {
    Scans = "scans",
    InstagramUsers = "instagram_users",
}

// Alias types for improved usability
export type IsoDateString = string
export type RecordIdString = string
export type HTMLString = string

// System fields
export type BaseSystemFields<T = never> = {
    id: RecordIdString
    created: IsoDateString
    updated: IsoDateString
    collectionId: string
    collectionName: Collections
    expand?: T
}

export type AuthSystemFields<T = never> = {
    email: string
    emailVisibility: boolean
    username: string
    verified: boolean
} & BaseSystemFields<T>

// Record types for each collection

export type ScansRecord = {
    user_id: string
    username?: string
    created?: IsoDateString
    updated?: IsoDateString
}

export type InstagramUsersRecord = {
    scan_id: RecordIdString
    username?: string
    full_name?: string
    user_id?: string
    profile_pic_url?: string
    is_private?: boolean
    is_verified?: boolean
    followed_by_viewer?: boolean
    follows_viewer?: boolean
    requested_by_viewer?: boolean
    created?: IsoDateString
    updated?: IsoDateString
}

// Response types include system fields and match responses from the PocketBase API
export type ScansResponse<Texpand = unknown> = ScansRecord & BaseSystemFields<Texpand>
export type InstagramUsersResponse<Texpand = unknown> = InstagramUsersRecord & BaseSystemFields<Texpand>

// Types containing all Records and Responses, useful for typing PocketBase collection checks
export type CollectionRecords = {
    [Collections.Scans]: ScansRecord
    [Collections.InstagramUsers]: InstagramUsersRecord
}

export type CollectionResponses = {
    [Collections.Scans]: ScansResponse
    [Collections.InstagramUsers]: InstagramUsersResponse
}
