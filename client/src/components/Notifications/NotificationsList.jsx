import React from "react";
import { AlertCircle, CheckCircle, Eye } from "lucide-react";

const NotificationsList = ({ notifications = [], onMarkRead }) => {
  return (
    <div className="bg-gradient-to-br from-amber-50/50 to-orange-50/50 rounded-lg p-6 shadow-sm border border-amber-100">
      <h3 className="text-lg font-semibold text-amber-900 mb-4 flex items-center">
        <div className="mr-2 w-1 h-6 bg-gradient-to-b from-amber-500 to-orange-500 rounded-full"></div>
        Recent Notifications
      </h3>
      <div className="space-y-4">
        {notifications.map((notification) => (
          <div
          key={notification._id || notification.id}
            className={`p-4 rounded-lg border-l-4 ${
              !notification.read
                ? "border-orange-500 bg-gradient-to-br from-orange-50 to-amber-50/70"
                : "border-amber-500 bg-gradient-to-br from-amber-50 to-orange-50/70"
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-3">
                {!notification.read ? (
                  <AlertCircle className="h-5 w-5 text-orange-600 mt-1 drop-shadow-sm" />
                ) : (
                  <CheckCircle className="h-5 w-5 text-amber-600 mt-1 drop-shadow-sm" />
                )}
                <div>
                  <h4 className="font-medium text-amber-900">
                    {notification.payload?.title || notification.title || "AyurSutra update"}
                  </h4>
                  <p className="text-sm text-amber-700 mt-1">
                    {notification.payload?.body || notification.message || "You have a new update."}
                  </p>
                  <p className="text-xs text-amber-600/70 mt-2">
                    {notification.scheduledAt ? new Date(notification.scheduledAt).toLocaleString() : notification.createdAt ? new Date(notification.createdAt).toLocaleString() : ''} · {notification.read ? 'Read' : 'Unread'}
                  </p>
                </div>
              </div>
              <button type="button" aria-label={notification.read ? "Notification read" : "Mark notification as read"} disabled={notification.read} onClick={() => onMarkRead?.(notification._id)} className="text-amber-500 hover:text-amber-700 transition-colors disabled:opacity-50">
                {notification.read ? <CheckCircle className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        ))}
      </div>
      {notifications.length === 0 && <p className="text-sm text-amber-700">You have no notifications yet.</p>}
    </div>
  );
};

export default NotificationsList;
