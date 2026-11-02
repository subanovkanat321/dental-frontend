import type { Schemas } from '../../api/client'
import { hasOptions, type Question } from '../../survey/texts'

type Details = Schemas['SurveyDetails']
type Definition = Schemas['SurveyDefinition']

/**
 * Тело запроса PUT/POST из черновика редактора или из сохранённого опроса («Копия»): только поля
 * контракта (без служебных key / saved), варианты — только у вопросов с вариантами.
 */
export function definitionOf(s: Pick<Details, 'title' | 'intro' | 'roles' | 'startsOn' | 'endsOn' | 'announce'>, questions: Question[]): Definition {
  return {
    title: s.title, intro: s.intro, roles: s.roles, startsOn: s.startsOn || undefined, endsOn: s.endsOn || undefined, announce: s.announce,
    questions: questions.map(({ id, type, text, options, required }) => ({ id, type, text, options: hasOptions(type) ? options : [], required })),
  }
}

