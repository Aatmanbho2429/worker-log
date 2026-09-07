use serde::Serialize;

use super::{Subscription, UserAccount};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub user: UserAccount,
    pub subscription: Subscription,
}
