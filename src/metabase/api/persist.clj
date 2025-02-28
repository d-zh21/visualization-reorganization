(ns metabase.api.persist
  (:require [clojure.string :as str]
            [clojure.tools.logging :as log]
            [compojure.core :refer [GET POST]]
            [honeysql.helpers :as hh]
            [metabase.api.common :as api]
            [metabase.api.common.validation :as validation]
            [metabase.driver.ddl.interface :as ddl.i]
            [metabase.models.card :refer [Card]]
            [metabase.models.collection :refer [Collection]]
            [metabase.models.database :refer [Database]]
            [metabase.models.interface :as mi]
            [metabase.models.persisted-info :as persisted-info :refer [PersistedInfo]]
            [metabase.public-settings :as public-settings]
            [metabase.server.middleware.offset-paging :as mw.offset-paging]
            [metabase.task.persist-refresh :as task.persist-refresh]
            [metabase.util :as u]
            [metabase.util.i18n :refer [deferred-tru tru]]
            [metabase.util.schema :as su]
            [schema.core :as s]
            [toucan.db :as db]
            [toucan.hydrate :refer [hydrate]]))

(defn- fetch-persisted-info
  "Returns a list of persisted info, annotated with database_name, card_name, and schema_name."
  [{:keys [persisted-info-id card-id db-ids]} limit offset]
  (let [site-uuid-str    (public-settings/site-uuid)
        db-id->fire-time (task.persist-refresh/job-info-by-db-id)]
    (-> (cond-> {:select    [:p.id :p.database_id :p.definition
                             :p.active :p.state :p.error
                             :p.refresh_begin :p.refresh_end
                             :p.table_name :p.creator_id
                             :p.card_id [:c.name :card_name]
                             [:db.name :database_name]
                             [:col.id :collection_id] [:col.name :collection_name]
                             [:col.authority_level :collection_authority_level]]
                 :from      [[PersistedInfo :p]]
                 :left-join [[Database :db] [:= :db.id :p.database_id]
                             [Card :c] [:= :c.id :p.card_id]
                             [Collection :col] [:= :c.collection_id :col.id]]
                 :order-by  [[:p.refresh_begin :desc]]}
          persisted-info-id (hh/merge-where [:= :p.id persisted-info-id])
          (seq db-ids) (hh/merge-where [:in :p.database_id db-ids])
          card-id (hh/merge-where [:= :p.card_id card-id])
          limit (hh/limit limit)
          offset (hh/offset offset))
        (db/query)
        (hydrate :creator)
        (->> (db/do-post-select PersistedInfo)
             (map (fn [{:keys [database_id] :as pi}]
                    (assoc pi
                           :schema_name (ddl.i/schema-name {:id database_id} site-uuid-str)
                           :next-fire-time (get-in db-id->fire-time [database_id :next-fire-time]))))))))

(api/defendpoint GET "/"
  "List the entries of [[PersistedInfo]] in order to show a status page."
  []
  (validation/check-has-application-permission :monitoring)
  (let [db-ids (db/select-field :database_id PersistedInfo)
        writable-db-ids (when (seq db-ids)
                          (->> (db/select Database :id [:in db-ids])
                               (filter mi/can-write?)
                               (map :id)
                               set))
        persisted-infos (fetch-persisted-info {:db-ids writable-db-ids} mw.offset-paging/*limit* mw.offset-paging/*offset*)]
    {:data   persisted-infos
     :total  (if (seq writable-db-ids)
               (db/count PersistedInfo :database_id [:in writable-db-ids])
               0)
     :limit  mw.offset-paging/*limit*
     :offset mw.offset-paging/*offset*}))

(api/defendpoint GET "/:persisted-info-id"
  "Fetch a particular [[PersistedInfo]] by id."
  [persisted-info-id]
  {persisted-info-id (s/maybe su/IntGreaterThanZero)}
  (api/let-404 [persisted-info (first (fetch-persisted-info {:persisted-info-id persisted-info-id} nil nil))]
    (api/write-check (Database (:database_id persisted-info)))
    persisted-info))

(api/defendpoint GET "/card/:card-id"
  "Fetch a particular [[PersistedInfo]] by card-id."
  [card-id]
  {card-id (s/maybe su/IntGreaterThanZero)}
  (api/let-404 [persisted-info (first (fetch-persisted-info {:card-id card-id} nil nil))]
    (api/write-check (Database (:database_id persisted-info)))
    persisted-info))

(def ^:private HoursInterval
  "Schema representing valid interval hours for refreshing persisted models."
  (su/with-api-error-message
    (s/constrained s/Int #(<= 1 % 24)
                   (deferred-tru "Integer greater than or equal to one and less than or equal to twenty-four"))
    (deferred-tru "Value must be an integer representing hours greater than or equal to one and less than or equal to twenty-four")))

(def ^:private AnchorTime
  "Schema representing valid anchor time for refreshing persisted models."
  (su/with-api-error-message
    (s/constrained s/Str (fn [t]
                           (let [[hours minutes] (map parse-long (str/split t #":"))]
                             (and (<= 0 hours 23) (<= 0 minutes 59))))
                   (deferred-tru "String representing a time in format HH:mm"))
    (deferred-tru "Value must be a string representing a time in format HH:mm")))

(api/defendpoint POST "/set-interval"
  "Set the interval (in hours) to refresh persisted models.
   Anchor can be provided to set the time to begin the interval (local to reporting-timezone or system).
   Shape should be JSON like {hours: 4, anchor: 16:45}."
  [:as {{:keys [hours anchor], :as _body} :body}]
  {hours (s/maybe HoursInterval)
   anchor (s/maybe AnchorTime)}
  (validation/check-has-application-permission :setting)
  (when hours
    (public-settings/persisted-model-refresh-interval-hours! hours))
  (if (and hours (< hours 6))
    (public-settings/persisted-model-refresh-anchor-time! "00:00")
    (when anchor
      (public-settings/persisted-model-refresh-anchor-time! anchor)))
  (task.persist-refresh/reschedule-refresh!)
  api/generic-204-no-content)

(api/defendpoint POST "/enable"
  "Enable global setting to allow databases to persist models."
  []
  (validation/check-has-application-permission :setting)
  (log/info (tru "Enabling model persistence"))
  (public-settings/persisted-models-enabled! true)
  (task.persist-refresh/enable-persisting!)
  api/generic-204-no-content)

(defn- disable-persisting
  "Disables persistence.
  - update all [[PersistedInfo]] rows to be inactive and deletable
  - remove `:persist-models-enabled` from relevant [[Database]] options
  - schedule a task to [[metabase.driver.ddl.interface/unpersist]] each table"
  []
  (let [id->db      (u/key-by :id (Database))
        enabled-dbs (filter (comp :persist-models-enabled :options) (vals id->db))]
    (log/info (tru "Disabling model persistence"))
    (doseq [db enabled-dbs]
      (db/update! Database (u/the-id db)
        :options (not-empty (dissoc (:options db) :persist-models-enabled))))
    (task.persist-refresh/disable-persisting!)))

(api/defendpoint POST "/disable"
  "Disable global setting to allow databases to persist models. This will remove all tasks to refresh tables, remove
  that option from databases which might have it enabled, and delete all cached tables."
  []
  (validation/check-has-application-permission :setting)
  (when (public-settings/persisted-models-enabled)
    (try (public-settings/persisted-models-enabled! false)
         (disable-persisting)
         (catch Exception e
           ;; re-enable so can continue to attempt to clean up
           (public-settings/persisted-models-enabled! true)
           (throw e))))
  api/generic-204-no-content)

(api/define-routes)
