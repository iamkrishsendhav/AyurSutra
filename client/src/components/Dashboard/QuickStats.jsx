import React from "react";
import { Calendar, CheckCircle, Bell, TrendingUp } from "lucide-react";

const QuickStats = ({ data }) => {
  const nextSession = data?.nextSession ? new Date(data.nextSession.split(" ")[0]).toLocaleString() : "Not scheduled";
  const stats = [
    {
      icon: Calendar,
      iconColor: "text-blue-600",
      bgColor: "bg-blue-100",
      label: "Next Session",
      value: nextSession,
    },
    {
      icon: CheckCircle,
      iconColor: "text-green-600",
      bgColor: "bg-green-100",
      label: "Completed",
      value: `${data?.completed ?? 0}/${data?.total ?? 0}`,
    },
    {
      icon: Bell,
      iconColor: "text-orange-600",
      bgColor: "bg-orange-100",
      label: "Notifications",
      value: data?.notifications ?? 0,
    },
    {
      icon: TrendingUp,
      iconColor: "text-purple-600",
      bgColor: "bg-purple-100",
      label: "Wellness Score",
      value: Number.isFinite(data?.wellnessScore) ? `${data.wellnessScore}/10` : "Not assessed",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {stats.map((stat, index) => {
        const IconComponent = stat.icon;
        return (
          <div
            key={index}
            className="bg-white rounded-lg p-4 shadow-sm border border-gray-200"
          >
            <div className="flex items-center">
              <div className={`p-2 ${stat.bgColor} rounded-lg`}>
                <IconComponent className={`h-6 w-6 ${stat.iconColor}`} />
              </div>
              <div className="ml-3">
                <p className="text-sm text-gray-500">{stat.label}</p>
                <p className="text-lg font-semibold">{stat.value}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default QuickStats;
